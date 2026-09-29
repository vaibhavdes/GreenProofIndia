import { api } from "./api";
import type { AppConfig } from "./types";

// The Upload Widget script is loaded in index.html.
declare global {
  interface Window {
    cloudinary?: {
      createUploadWidget: (
        options: Record<string, unknown>,
        callback: (error: unknown, result: { event: string; info: Record<string, unknown> }) => void,
      ) => { open: () => void; destroy: () => void };
    };
  }
}

function devicePosition(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }),
  );
}

export interface UploadOptions {
  config: AppConfig;
  projectId: string;
  siteId?: string;
  kind: "image" | "video";
  uploader?: string;
  onUploaded: (publicId: string, resourceType: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** Opens the Cloudinary Upload Widget with a signed preset (AI tagging, captioning, metadata and phash run at upload). */
export async function openUploader(o: UploadOptions) {
  if (!window.cloudinary) {
    o.onError("The Cloudinary Upload Widget did not load. Check your connection and reload.");
    return;
  }
  if (!o.config.cloud_name || !o.config.api_key) {
    o.onError("Cloudinary is not configured on the server yet.");
    return;
  }
  // The phone's position at upload time: a weaker signal, used only when the file has no GPS.
  const position = await devicePosition();
  const context: Record<string, string> = { gp_project: o.projectId };
  if (o.siteId) context.gp_site = o.siteId;
  if (position) {
    context.gp_dev_lat = position.coords.latitude.toFixed(6);
    context.gp_dev_lng = position.coords.longitude.toFixed(6);
    context.gp_dev_acc = String(Math.round(position.coords.accuracy));
  }
  const name = (o.uploader ?? "").replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 40);
  if (name) context.gp_by = name;

  const widget = window.cloudinary.createUploadWidget(
    {
      cloudName: o.config.cloud_name,
      apiKey: o.config.api_key,
      uploadPreset: o.kind === "image" ? o.config.image_preset : o.config.video_preset,
      uploadSignature: (callback: (signature: string) => void, params: Record<string, unknown>) => {
        api
          .sign(params)
          .then((r) => callback(r.signature))
          .catch((e: Error) => o.onError(e.message));
      },
      folder: `${o.config.folder}/${o.projectId}`,
      tags: ["gp", `gp_p_${o.projectId}`],
      context,
      resourceType: o.kind,
      sources: ["local", "camera", "url"],
      multiple: true,
      maxFiles: 50,
      maxFileSize: o.kind === "image" ? 20_000_000 : 100_000_000,
      clientAllowedFormats: o.kind === "image" ? ["jpg", "jpeg", "png", "webp", "heic", "heif"] : ["mp4", "mov", "webm", "3gp", "m4v"],
      cropping: false, // evidence is never edited before upload
      showAdvancedOptions: false,
      singleUploadAutoClose: false,
      styles: {
        palette: {
          window: "#FFFFFF",
          windowBorder: "#A8A29E",
          tabIcon: "#047857",
          menuIcons: "#44403C",
          textDark: "#1C1917",
          textLight: "#FFFFFF",
          link: "#047857",
          action: "#047857",
          inactiveTabIcon: "#78716C",
          error: "#DC2626",
          inProgress: "#0284C7",
          complete: "#059669",
          sourceBg: "#F5F5F4",
        },
      },
    },
    (error, result) => {
      if (error) {
        o.onError(typeof error === "string" ? error : "Upload failed");
        return;
      }
      if (result.event === "success") {
        o.onUploaded(String(result.info.public_id), String(result.info.resource_type));
      }
      if (result.event === "close") {
        o.onDone();
        widget.destroy();
      }
    },
  );
  widget.open();
}
