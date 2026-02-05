import { GoogleGenAI, Type } from "@google/genai";
import { DesignBrief, AttachedFile, AttachedLink } from "../types";

export type ModelType = 'gemini-3-flash-preview' | 'gemini-3-pro-preview';

/**
 * Helper to execute API calls with exponential backoff.
 * Propagates 429 errors so the UI can trigger the API Key Selection workflow.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let delay = 2000;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorString = JSON.stringify(error);
      const isQuotaError = 
        error?.status === 429 || 
        errorString.includes('429') || 
        errorString.includes('RESOURCE_EXHAUSTED');
      
      const isEntityError = errorString.includes("Requested entity was not found.");

      if (isEntityError) {
        throw new Error("ENTITY_NOT_FOUND");
      }

      if (isQuotaError && i < maxRetries) {
        console.warn(`Quota exceeded. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  throw new Error("RETRY_LIMIT_REACHED");
}

export async function generateDesignBrief(
  files: AttachedFile[], 
  links: AttachedLink[], 
  manualPrompt?: string, 
  selectedComponent?: string,
  model: ModelType = 'gemini-3-flash-preview'
): Promise<DesignBrief> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const fileParts = files.map(f => ({
    inlineData: {
      data: f.base64.split(',')[1],
      mimeType: f.type
    }
  }));

  const prompt = `Act as a world-class UI/UX Strategist. Analyze the user request to create a professional vector design brief.
  Focus: Modern Flat Professional aesthetic (Flat Design 2.0).

  USER REQUEST: ${manualPrompt || "Premium UI Illustration"}
  STYLE PRESET: ${selectedComponent || "Modern Flat Professional"}
  
  REQUIRED OUTPUT:
  1. SUGGESTED TITLE: Optimized for professional design marketplaces.
  2. KEYWORDS: 30 professional tags for SEO.
  3. COLORS: A sophisticated flat design palette.
  
  Return valid JSON.`;

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: model,
      contents: fileParts.length > 0 ? { parts: [...fileParts, { text: prompt }] } : prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            primaryColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            visualStyle: { type: Type.STRING, enum: ['Modern', 'Minimalist', 'Brutalist', 'Corporate', 'Playful', 'Realistic 3D'] },
            pages: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedTitle: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "description", "targetAudience", "primaryColors", "visualStyle", "pages", "suggestedTitle", "keywords"]
        }
      }
    });

    const text = response.text || '{}';
    return { ...JSON.parse(text), selectedComponent };
  });
}

export async function generateSVGDesign(
  brief: DesignBrief,
  model: ModelType = 'gemini-3-flash-preview'
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const isFlat = brief.selectedComponent === 'Modern Flat Professional' || brief.selectedComponent === 'Minimalist Dashboard' || brief.selectedComponent === 'SaaS Landing Page' || brief.selectedComponent === 'UI Button Package';

  const prompt = `Generate a production-ready, high-end SVG Design.
  
  TITLE: ${brief.suggestedTitle}
  THEME: ${brief.description}
  STYLE: ${isFlat ? 'Flat Design 2.0 (Modern Professional, Geometric Precision)' : 'Premium UI/UX Package'}
  PALETTE: ${brief.primaryColors.join(', ')}

  DESIGN SPECIFICATIONS:
  - SVG: Use standards-compliant SVG 1.1 or 2.0 tags.
  - GROUPING: Logical sections must be grouped with <g> for editing.
  - TYPOGRAPHY: Use 'Inter' or system sans-serif. Use high-contrast hierarchy.
  - AESTHETIC: Clean lines, balanced whitespace, and professional iconography.
  - If FLAT: No heavy shadows. Use subtle 1px strokes and sophisticated color blocking.
  ${brief.selectedComponent === 'UI Button Package' ? '- SPECIFIC TASK: Generate a comprehensive UI kit layout of varied buttons (Primary, Secondary, Outline, Ghost, With Icons, Different sizes, Loading states) arranged in a neat grid.' : ''}
  
  Canvas: 1440x900. Return ONLY the raw <svg> tag.`;

  return await withRetry(async () => {
    const config: any = {
      temperature: 0.7,
    };

    // Only apply thinking to Pro model if explicitly selected
    if (model === 'gemini-3-pro-preview') {
      config.thinkingConfig = { thinkingBudget: 16000 };
    }

    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: config
    });

    const text = response.text || '';
    const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
    if (!svgMatch) throw new Error("SVG_PARSE_FAILED");
    return svgMatch[0];
  });
}
