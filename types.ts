
export interface DesignBrief {
  title: string;
  description: string;
  targetAudience: string;
  primaryColors: string[];
  visualStyle: 'Modern' | 'Minimalist' | 'Brutalist' | 'Corporate' | 'Playful' | 'Realistic 3D';
  pages: string[];
  selectedComponent?: string;
  keywords?: string[];
  suggestedTitle?: string;
}

export interface DesignProject {
  id: string;
  name: string;
  svgContent: string;
  brief: DesignBrief;
  createdAt: number;
}

export interface AttachedFile {
  name: string;
  type: string;
  base64: string;
}

export interface AttachedLink {
  url: string;
  title?: string;
}
