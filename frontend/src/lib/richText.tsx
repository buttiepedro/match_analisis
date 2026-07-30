import { Fragment, type ReactNode } from "react";

/*
  Texto con formato para los avisos de la bolsa.

  **Genera elementos de React, no HTML.** Es la decisión que define el módulo:
  con `dangerouslySetInnerHTML` habría que sanear lo que escribe un socio, y
  sanear HTML a mano es una carrera que se pierde. Acá el texto del usuario sólo
  puede terminar como contenido de un nodo de texto — no hay forma de que se
  convierta en markup, porque nunca se interpreta como markup.

  El subconjunto es a propósito chico. Alcanza para que un aviso tenga jerarquía
  y se lea, y no alcanza para que cada uno invente su propio diseño:

      ## Subtítulo
      **negrita**  _cursiva_
      - viñeta
      1. numerado
      https://links.automaticos

  No hay tipografías ni tamaños libres. Treinta avisos con treinta tipografías se
  ven como un tablón de corcho; lo que da la sensación de portal es que todos
  usen la misma jerarquía.
*/

/** Sólo http(s). `javascript:` en un href es un XSS con otra ropa. */
function isSafeHref(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g;

/** Autolinkea las URLs sueltas de un fragmento ya libre de otras marcas. */
function withLinks(text: string, keyBase: string): ReactNode[] {
  return text.split(URL_RE).map((parte, i) => {
    if (i % 2 === 1 && isSafeHref(parte)) {
      return (
        <a
          key={`${keyBase}-l${i}`}
          href={parte}
          target="_blank"
          // `noopener` evita que la página abierta toque la nuestra por
          // `window.opener`; `noreferrer` no le pasa de dónde vino el socio.
          rel="noopener noreferrer"
          className="text-brand underline decoration-brand/30 hover:decoration-brand break-words"
        >
          {parte.replace(/^https?:\/\//, "")}
        </a>
      );
    }
    return <Fragment key={`${keyBase}-t${i}`}>{parte}</Fragment>;
  });
}

const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /_([^_]+)_/g;

/** Negrita y cursiva dentro de una línea, más los links. */
function inline(text: string, keyBase: string): ReactNode[] {
  const salida: ReactNode[] = [];

  text.split(BOLD_RE).forEach((trozo, i) => {
    const key = `${keyBase}-b${i}`;
    if (i % 2 === 1) {
      salida.push(
        <strong key={key} className="font-semibold text-ink">
          {withLinks(trozo, key)}
        </strong>
      );
      return;
    }
    trozo.split(ITALIC_RE).forEach((sub, j) => {
      const subKey = `${key}-i${j}`;
      salida.push(
        j % 2 === 1 ? (
          <em key={subKey}>{withLinks(sub, subKey)}</em>
        ) : (
          <Fragment key={subKey}>{withLinks(sub, subKey)}</Fragment>
        )
      );
    });
  });

  return salida;
}

type Block =
  | { type: "heading"; lines: string[] }
  | { type: "bullets"; lines: string[] }
  | { type: "numbers"; lines: string[] }
  | { type: "paragraph"; lines: string[] };

/**
 * Agrupa las líneas en bloques.
 *
 * Se hace en dos pasos —agrupar y después renderizar— porque las listas son el
 * único bloque de varias líneas, y detectarlas al vuelo mientras se renderiza
 * termina en un estado que hay que ir arrastrando.
 */
function toBlocks(source: string): Block[] {
  const bloques: Block[] = [];
  /*
    Una línea en blanco **cierra** el bloque en curso, no se ignora. Es la
    diferencia entre un Enter y un Enter doble, y es lo único que le deja a
    alguien separar dos párrafos: ignorándola, todo el aviso terminaba pegado en
    uno solo.
  */
  let cerrado = true;

  for (const raw of (source || "").replace(/\r\n/g, "\n").split("\n")) {
    const linea = raw.trim();

    if (!linea) {
      cerrado = true;
      continue;
    }

    const ultimo = cerrado ? undefined : bloques[bloques.length - 1];

    if (/^#{1,3}\s+/.test(linea)) {
      bloques.push({ type: "heading", lines: [linea.replace(/^#{1,3}\s+/, "")] });
      // Un subtítulo es de una sola línea: lo que venga abajo empieza aparte.
      cerrado = true;
      continue;
    }

    if (/^[-*•]\s+/.test(linea)) {
      const item = linea.replace(/^[-*•]\s+/, "");
      if (ultimo?.type === "bullets") ultimo.lines.push(item);
      else bloques.push({ type: "bullets", lines: [item] });
    } else if (/^\d+[.)]\s+/.test(linea)) {
      const item = linea.replace(/^\d+[.)]\s+/, "");
      if (ultimo?.type === "numbers") ultimo.lines.push(item);
      else bloques.push({ type: "numbers", lines: [item] });
    } else if (ultimo?.type === "paragraph") {
      // Un Enter simple corta el renglón sin abrir un párrafo nuevo: es como se
      // escribe en un teléfono.
      ultimo.lines.push(linea);
    } else {
      bloques.push({ type: "paragraph", lines: [linea] });
    }

    cerrado = false;
  }

  return bloques;
}

/** Renderiza el texto del aviso. Compacto para la tarjeta, holgado para la página. */
export function RichText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const bloques = toBlocks(text);

  return (
    <div className={`space-y-3 ${className}`}>
      {bloques.map((bloque, i) => {
        const key = `b${i}`;
        if (bloque.type === "heading") {
          return (
            <h3 key={key} className="text-base font-bold text-ink pt-1">
              {inline(bloque.lines[0], key)}
            </h3>
          );
        }
        if (bloque.type === "bullets") {
          return (
            <ul key={key} className="list-disc pl-5 space-y-1">
              {bloque.lines.map((linea, j) => (
                <li key={`${key}-${j}`} className="text-ink-soft">
                  {inline(linea, `${key}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (bloque.type === "numbers") {
          return (
            <ol key={key} className="list-decimal pl-5 space-y-1">
              {bloque.lines.map((linea, j) => (
                <li key={`${key}-${j}`} className="text-ink-soft">
                  {inline(linea, `${key}-${j}`)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key} className="text-ink-soft leading-relaxed">
            {bloque.lines.map((linea, j) => (
              <Fragment key={`${key}-${j}`}>
                {j > 0 && <br />}
                {inline(linea, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
