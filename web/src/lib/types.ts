export type LatLng = [number, number];
export type Grade = "strong" | "review" | "weak";

export interface Check {
  key: "location" | "time" | "originality" | "integrity";
  label: string;
  points: number;
  max: number;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface Proof {
  score: number;
  grade: Grade;
  checks: Check[];
}

export interface Evidence {
  id: string;
  public_id: string;
  version?: number;
  resource_type: "image" | "video";
  status: "processing" | "ready" | "error";
  error?: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
  etag?: string;
  sha256?: string | null;
  phash?: string;
  uploaded_at?: string;
  uploader?: string | null;
  exif?: {
    lat: number | null;
    lng: number | null;
    taken_at: string | null;
    heading: number | null;
    make?: string | null;
    model?: string | null;
    software?: string | null;
  };
  device?: { lat: number; lng: number; accuracy_m?: number | null } | null;
  site_id?: string | null;
  site_source?: string;
  tags?: string[];
  caption?: string | null;
  activities?: { name: string; confidence: number | null; via: string }[];
  faces?: number;
  quality?: number | null;
  ai?: Record<string, string>;
  review?: { status: "pending" | "accepted" | "rejected"; note?: string | null; at?: string };
  proof?: Proof;
  views?: { thumb: string; large: string; slider?: string; video?: string };
}

export interface SiteMetrics {
  boundary_ha: number;
  evidence: number;
  photos: number;
  videos: number;
  avg_proof: number | null;
  flagged: number;
  activities: [string, number][];
  water?: {
    baseline_ha: number;
    baseline_date: string;
    latest_ha: number;
    latest_date: string;
    change_ha: number | null;
    change_pct: number | null;
  };
  survival?: {
    date: string;
    planted: number;
    alive: number;
    pct: number | null;
  };
}

export interface Pair {
  site_id: string;
  before: string;
  after: string;
  auto: boolean;
  days: number;
  reason: string;
}

export interface Site {
  id: string;
  name: string;
  kind: "lake" | "plantation";
  boundary: LatLng[];
  baseline_date?: string | null;
  metrics: SiteMetrics;
  pair: Pair | null;
}

export interface Measurement {
  id: string;
  site_id: string;
  date: string;
  kind: "water" | "survival";
  water_area_ha?: number;
  water_polygon?: LatLng[] | null;
  plot?: string | null;
  planted?: number;
  alive?: number;
  note?: string | null;
}

export interface Story {
  id: string;
  created_at: string;
  status: "processing" | "ready" | "error";
  error?: string;
  reel?: { url: string; tag: string } | null;
  pack?: { url: string; tag: string } | null;
  reel_error?: string;
  pack_error?: string;
  composites?: { site_id: string; url: string; before: string; after: string }[];
  social?: { site_id: string; evidence_id: string; square: string; vertical: string; wide: string }[];
  headline?: string[];
  sources?: string[];
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail: string;
  ref?: string | null;
}

export interface ProjectMetrics {
  sites: number;
  evidence: number;
  avg_proof: number | null;
  flagged: number;
  water_gain_ha: number | null;
  trees_planted: number | null;
  trees_alive: number | null;
  survival_pct: number | null;
}

export interface Project {
  id: string;
  name: string;
  kind: "lake" | "plantation" | "mixed";
  org?: string | null;
  funder?: string | null;
  description?: string | null;
  start_date?: string | null;
  created_at: string;
  sites: Site[];
  evidence: Evidence[];
  measurements: Measurement[];
  metrics: ProjectMetrics;
  summary: string[];
  stories: Story[];
  audit: AuditEntry[];
  share_token?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  kind: string;
  org?: string | null;
  funder?: string | null;
  sites: number;
  evidence: number;
  cover: string | null;
  created_at: string;
}

export interface AppConfig {
  cloud_name: string | null;
  api_key: string | null;
  ready: boolean;
  error: string | null;
  folder: string;
  image_preset: string;
  video_preset: string;
  editor_key_required: boolean;
  activities: string[];
}

export interface Provenance {
  original: {
    public_id: string;
    version?: number;
    asset_id: string;
    format?: string;
    bytes?: number;
    width?: number;
    height?: number;
    etag_md5?: string;
    sha256?: string | null;
    phash?: string;
    uploaded_at?: string;
    url?: string | null;
  };
  outputs: { kind: string; url: string; story: string; at: string }[];
  cloudinary_derived: { transformation?: string; url?: string; bytes?: number; error?: string }[];
  events: AuditEntry[];
}
