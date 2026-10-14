import { useEffect, useState } from "react";
import { acquireThumbnail, releaseThumbnail, resolveMediaPath } from "../database";

function useThumbnail(assetId: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    let acquired = false;
    setUrl("");
    acquireThumbnail(assetId)
      .then((value) => {
        acquired = true;
        if (cancelled) releaseThumbnail(assetId);
        else setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setUrl(resolveMediaPath("/media/scene-0.svg"));
      });
    return () => {
      cancelled = true;
      if (acquired) releaseThumbnail(assetId);
    };
  }, [assetId]);
  return url;
}

export function Thumbnail({
  assetId,
  alt,
  ...props
}: {
  assetId: string;
  alt: string;
  className?: string;
}) {
  const url = useThumbnail(assetId);
  return url ? (
    <img
      {...props}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = resolveMediaPath("/media/scene-0.svg");
      }}
    />
  ) : (
    <div className="thumbnail-loading" />
  );
}

