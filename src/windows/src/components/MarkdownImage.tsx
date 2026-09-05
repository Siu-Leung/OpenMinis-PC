import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Image as ImageIcon,
  ExternalLink,
  Download,
  Maximize2,
  X,
  AlertCircle,
  Volume2,
  Film,
  Music,
  Play
} from "lucide-react";

interface MarkdownImageProps {
  src?: string;
  alt?: string;
  className?: string;
}

export function MarkdownImage({ src, alt, className }: MarkdownImageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // 判断媒体类型
  const cleanUrl = (src || "").toLowerCase().split("?")[0].split("#")[0];
  const isAudio = cleanUrl.endsWith(".mp3") || cleanUrl.endsWith(".wav") || cleanUrl.endsWith(".m4a") || cleanUrl.endsWith(".ogg") || cleanUrl.endsWith(".flac") || cleanUrl.endsWith(".aac");
  const isVideo = cleanUrl.endsWith(".mp4") || cleanUrl.endsWith(".mov") || cleanUrl.endsWith(".webm") || cleanUrl.endsWith(".m4v");

  useEffect(() => {
    if (!src) {
      setError("未指定媒体路径");
      setLoading(false);
      return;
    }

    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      setDataUrl(src);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    invoke<string>("read_image_data_url", { pathOrUrl: src })
      .then((url) => {
        if (isMounted) {
          setDataUrl(url);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("加载媒体失败:", err);
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src]);

  if (loading) {
    return (
      <div className="my-3 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/5 dark:bg-white/5 border border-[#E5E5EA] dark:border-[#2C2C2E] text-xs text-[#8E8E93] animate-pulse select-none">
        {isAudio ? <Music className="w-4 h-4 text-[#FF9500] animate-bounce" /> : isVideo ? <Film className="w-4 h-4 text-[#AF52DE] animate-pulse" /> : <ImageIcon className="w-4 h-4 text-[#0A84FF] animate-spin" />}
        <span>正在加载媒体资源...</span>
      </div>
    );
  }

  if (error || !dataUrl) {
    // 优雅降级：绝不渲染刺眼的大红报错框，改用原生极简灰色占位胶囊
    return (
      <span
        className="my-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-xs text-[#8E8E93] select-none"
        title={error || "媒体未就绪"}
      >
        <ImageIcon className="w-3.5 h-3.5 text-[#8E8E93]" />
        <span className="truncate max-w-xs">{alt || src || "媒体资源"}</span>
      </span>
    );
  }

  // --- 音频内嵌播放器 (1:1 原版质感) ---
  if (isAudio) {
    return (
      <div className="my-3 p-3 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-sm max-w-lg space-y-2 select-none">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-black dark:text-white font-medium truncate">
            <Volume2 className="w-4 h-4 text-[#FF9500] shrink-0" />
            <span className="truncate">{alt || src?.split("/").pop() || "Audio Playback"}</span>
          </div>
          <a
            href={dataUrl}
            download={alt || "audio.mp3"}
            className="p-1 text-[#8E8E93] hover:text-black dark:hover:text-white rounded hover:bg-black/5 dark:hover:bg-white/10 transition"
            title="下载音频"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
        <audio controls src={dataUrl} className="w-full h-9 rounded-lg" />
      </div>
    );
  }

  // --- 视频内嵌播放器 (1:1 原版质感) ---
  if (isVideo) {
    return (
      <div className="my-3 rounded-2xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E] bg-black shadow-md max-w-xl">
        {alt && (
          <div className="px-3.5 py-2 text-xs font-medium text-white/90 bg-[#1C1C1E] border-b border-[#2C2C2E] flex items-center justify-between">
            <div className="flex items-center gap-2 truncate">
              <Film className="w-4 h-4 text-[#AF52DE]" />
              <span className="truncate">{alt}</span>
            </div>
            <a
              href={dataUrl}
              download={alt || "video.mp4"}
              className="p-1 text-[#8E8E93] hover:text-white rounded hover:bg-white/10 transition"
              title="下载视频"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
        <video controls src={dataUrl} className="w-full max-h-[460px] object-contain bg-black" />
      </div>
    );
  }

  // --- 原生图片渲染 (带全屏灯箱放大与下载) ---
  return (
    <>
      <div className="my-3 group relative inline-block max-w-full rounded-2xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E] bg-black/5 dark:bg-[#1C1C1E] shadow-sm">
        <img
          src={dataUrl}
          alt={alt || "快照图片"}
          onClick={() => setShowPreviewModal(true)}
          className={`max-h-96 max-w-full object-contain cursor-zoom-in transition-transform duration-200 group-hover:scale-[1.01] ${className || ""}`}
        />

        {/* 悬停快捷浮条 */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-md rounded-xl p-1 flex items-center gap-1 text-white shadow-lg">
          <button
            onClick={() => setShowPreviewModal(true)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition"
            title="全屏放大查看"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              const a = document.createElement("a");
              a.href = dataUrl;
              a.download = alt || "media.png";
              a.click();
            }}
            className="p-1.5 hover:bg-white/20 rounded-lg transition"
            title="保存到本地"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>

        {alt && (
          <div className="px-3 py-1.5 text-[11px] text-[#8E8E93] border-t border-[#E5E5EA] dark:border-[#2C2C2E] truncate bg-white/40 dark:bg-[#141416]/50">
            {alt}
          </div>
        )}
      </div>

      {/* 点击全屏灯箱模态窗口 */}
      {showPreviewModal && (
        <div
          onClick={() => setShowPreviewModal(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150 cursor-zoom-out"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl max-h-[92vh] flex flex-col items-center select-none cursor-default"
          >
            <button
              onClick={() => setShowPreviewModal(false)}
              className="absolute -top-10 right-0 p-1.5 text-white/80 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition"
              title="关闭"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={dataUrl}
              alt={alt || "快照大图"}
              className="max-h-[85vh] max-w-full rounded-2xl shadow-2xl object-contain border border-white/10"
            />
            {alt && (
              <div className="mt-3 text-xs text-white/80 font-medium">{alt}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
