import { useRef, useState } from "react";

/*
  Editor del aviso: barra de formato, emojis y vista previa.

  Trabaja sobre el texto plano del textarea y no sobre un documento
  contenteditable. Un contenteditable trae su propio HTML —el que pega el
  usuario desde Word, con sus `<span style>` adentro— y ahí hay que sanear. Con
  texto plano y marcas simples no hay nada que sanear: lo peor que puede escribir
  alguien es un asterisco de más.
*/

const EMOJIS: { grupo: string; items: string[] }[] = [
  {
    grupo: "Trabajo",
    items: ["💼", "🔧", "🔨", "🪚", "🧱", "🚚", "🧹", "🪛", "⚡", "🪜", "🎨", "💻", "📐", "🧰"],
  },
  {
    grupo: "Contacto",
    items: ["📱", "☎️", "📧", "📍", "🗓️", "⏰", "💬", "🙋", "👋", "✅", "❗", "⭐"],
  },
  {
    grupo: "Club",
    items: ["🏉", "🏆", "💪", "🔵", "⚪", "🎉", "🙌", "🤝", "❤️", "🔥", "👏", "🥳"],
  },
];

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}

export default function Composer({ value, onChange, placeholder, rows = 6 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [emojisOpen, setEmojisOpen] = useState(false);

  /**
   * Inserta texto respetando la selección.
   *
   * Sin esto, cada botón manda el cursor al final y escribir con formato se
   * vuelve un ida y vuelta de clics y flechas.
   */
  const insertar = (antes: string, despues = "", placeholderTexto = "") => {
    const ta = ref.current;
    if (!ta) return;

    const inicio = ta.selectionStart;
    const fin = ta.selectionEnd;
    const seleccion = value.slice(inicio, fin) || placeholderTexto;
    const siguiente = value.slice(0, inicio) + antes + seleccion + despues + value.slice(fin);

    onChange(siguiente);

    // Se devuelve el foco y se deja el cursor donde uno seguiría escribiendo.
    requestAnimationFrame(() => {
      ta.focus();
      const desde = inicio + antes.length;
      ta.setSelectionRange(desde, desde + seleccion.length);
    });
  };

  /** Las marcas de línea van al principio del renglón, no donde esté el cursor. */
  const prefijarLinea = (marca: string) => {
    const ta = ref.current;
    if (!ta) return;
    const inicio = ta.selectionStart;
    const arranqueLinea = value.lastIndexOf("\n", inicio - 1) + 1;
    const siguiente = value.slice(0, arranqueLinea) + marca + value.slice(arranqueLinea);
    onChange(siguiente);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(inicio + marca.length, inicio + marca.length);
    });
  };

  const boton =
    "pressable px-2.5 py-1.5 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors duration-150";

  return (
    <div className="bg-surface-strong rounded-xl overflow-hidden">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-line flex-wrap">
        <button type="button" onClick={() => insertar("**", "**", "negrita")} className={boton} title="Negrita">
          <span className="font-bold">N</span>
        </button>
        <button type="button" onClick={() => insertar("_", "_", "cursiva")} className={boton} title="Cursiva">
          <span className="italic">C</span>
        </button>
        <span className="w-px h-4 bg-line mx-1" />
        <button type="button" onClick={() => prefijarLinea("## ")} className={boton} title="Subtítulo">
          Subtítulo
        </button>
        <button type="button" onClick={() => prefijarLinea("- ")} className={boton} title="Viñeta">
          • Lista
        </button>
        <button type="button" onClick={() => prefijarLinea("1. ")} className={boton} title="Lista numerada">
          1. Pasos
        </button>
        <span className="w-px h-4 bg-line mx-1" />
        <button
          type="button"
          onClick={() => setEmojisOpen((v) => !v)}
          className={`${boton} ${emojisOpen ? "bg-surface-hover text-ink" : ""}`}
          title="Emojis"
        >
          😀
        </button>
      </div>

      {emojisOpen && (
        <div className="px-3 py-2 border-b border-line space-y-2 max-h-44 overflow-y-auto">
          {EMOJIS.map((grupo) => (
            <div key={grupo.grupo}>
              <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mb-1">
                {grupo.grupo}
              </p>
              <div className="flex flex-wrap gap-0.5">
                {grupo.items.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertar(emoji)}
                    className="pressable w-8 h-8 rounded-lg text-lg leading-none hover:bg-surface-hover transition-colors duration-150"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-ink text-sm px-3 py-2.5 placeholder-ink-faint outline-none resize-y leading-relaxed"
      />
    </div>
  );
}
