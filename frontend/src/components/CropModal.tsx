import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { useCallback, useState } from "react";

async function getCroppedImg(imageSrc: string, cropPixels: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = cropPixels.width;
      canvas.height = cropPixels.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no 2d context")); return; }
      ctx.drawImage(
        img,
        cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
        0, 0, cropPixels.width, cropPixels.height,
      );
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("canvas vacío"))),
        "image/png",
      );
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

interface Props {
  imageSrc: string;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

export default function CropModal({ imageSrc, onConfirm, onCancel }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      onConfirm(blob);
    } catch {
      alert("Error al recortar la imagen");
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-overlay">
      <div className="bg-white rounded-2xl w-full max-w-sm flex flex-col gap-4 p-6 shadow-2xl animate-modal">
        <h2 className="text-ink font-bold text-base">Recortar foto</h2>

        <div className="relative w-full rounded-xl overflow-hidden" style={{ height: 300 }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-ink-muted text-xs shrink-0">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-green-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={processing}
            className="pressable flex-1 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
          >
            {processing ? "Procesando..." : "Recortar y subir"}
          </button>
          <button
            onClick={onCancel}
            disabled={processing}
            className="pressable flex-1 bg-surface-strong hover:bg-surface-hover disabled:opacity-40 text-ink-soft text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
