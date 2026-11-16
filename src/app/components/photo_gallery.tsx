import { useEffect, useState } from 'react';
import { useDb } from '../data_context';
import './photo_gallery.css';

/** Thumbnails for image paths (relative to data/), read straight from the picked folder. */
export function PhotoGallery({ paths }: { paths: string[] }): JSX.Element | null {
  const { storage } = useDb();
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  const [open, setOpen] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    Promise.all(paths.map((p) => storage.objectUrl(p))).then((u) => !cancelled && setUrls(u));
    return () => {
      cancelled = true;
    };
  }, [paths, storage]);

  if (paths.length === 0) return null;
  return (
    <>
      <div className="photoGallery">
        {urls.map((u, i) =>
          u ? (
            <button key={paths[i]} type="button" onClick={() => setOpen(u)}>
              <img src={u} alt={`Photo ${i + 1}`} loading="lazy" />
            </button>
          ) : (
            <div key={paths[i]} className="missing" title={paths[i]}>
              missing
            </div>
          ),
        )}
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(undefined)} role="presentation">
          <img src={open} alt="" />
        </div>
      )}
    </>
  );
}
