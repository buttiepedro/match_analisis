/**
 * El texto de un aviso no puede convertirse en markup.
 *
 * `RichText` genera elementos de React, así que el texto del usuario sólo puede
 * terminar como contenido de un nodo de texto. Estos tests recorren el árbol que
 * devuelve y verifican dos cosas: que el formato salga como los elementos
 * correctos, y que nada de lo que escriba un socio termine ejecutándose.
 */
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { RichText } from "./richText";

/**
 * Árbol plano de los elementos que produce el render, para poder inspeccionarlo.
 *
 * Se invoca `RichText` como función en vez de montarla: lo que se quiere revisar
 * es qué elementos y qué props genera, no cómo se ven.
 */
function render(text: string): { tags: string[]; props: Record<string, unknown>[]; text: string } {
  const tags: string[] = [];
  const props: Record<string, unknown>[] = [];
  let plano = "";

  const walk = (node: ReactNode): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      plano += String(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isValidElement(node)) {
      const { type, props: p } = node as { type: unknown; props: Record<string, unknown> };
      if (typeof type === "string") {
        tags.push(type);
        props.push(p);
      }
      walk(p.children as ReactNode);
    }
  };

  walk((RichText as (p: { text: string }) => ReactNode)({ text }));

  return { tags, props, text: plano };
}

describe("formato", () => {
  it("convierte ## en un subtítulo", () => {
    expect(render("## Requisitos").tags).toContain("h3");
  });

  it("convierte ** en negrita y _ en cursiva", () => {
    const { tags } = render("**urgente** y _serio_");
    expect(tags).toContain("strong");
    expect(tags).toContain("em");
  });

  it("agrupa viñetas seguidas en una sola lista", () => {
    const { tags } = render("- uno\n- dos\n- tres");
    expect(tags.filter((t) => t === "ul")).toHaveLength(1);
    expect(tags.filter((t) => t === "li")).toHaveLength(3);
  });

  it("distingue lista numerada de viñetas", () => {
    expect(render("1. primero\n2. segundo").tags).toContain("ol");
    expect(render("1. primero\n2. segundo").tags).not.toContain("ul");
  });

  it("mantiene el texto tal como se escribió", () => {
    expect(render("**Muñiz** trabaja en Añatuya").text).toContain("Muñiz");
    expect(render("Precio: 20% más").text).toContain("20% más");
  });

  it("deja pasar emojis sin tocarlos", () => {
    expect(render("Busco changas 🔧💼").text).toContain("🔧💼");
  });

  it("un texto vacío no rompe: queda el contenedor y nada de contenido", () => {
    const { tags, text } = render("");
    expect(tags).toEqual(["div"]);
    expect(text).toBe("");
  });

  it("las líneas en blanco no dejan párrafos vacíos", () => {
    const { tags } = render("uno\n\n\n\ndos");
    expect(tags.filter((t) => t === "p")).toHaveLength(2);
  });
});

describe("links", () => {
  it("autolinkea una URL suelta", () => {
    const { tags, props } = render("Mirá https://ejemplo.com/aviso");
    expect(tags).toContain("a");
    const link = props.find((p) => p.href);
    expect(link?.href).toBe("https://ejemplo.com/aviso");
  });

  it("abre en pestaña nueva sin exponer la nuestra", () => {
    // Sin `noopener`, la página abierta puede tocar la nuestra por window.opener.
    const { props } = render("https://ejemplo.com");
    const link = props.find((p) => p.href);
    expect(link?.target).toBe("_blank");
    expect(String(link?.rel)).toContain("noopener");
    expect(String(link?.rel)).toContain("noreferrer");
  });

  it("NO linkea javascript: — es un XSS con otra ropa", () => {
    const { tags, text } = render("javascript:alert(1)");
    expect(tags).not.toContain("a");
    // Queda como texto visible, que es lo correcto: se ve y no hace nada.
    expect(text).toContain("javascript:alert(1)");
  });

  it("NO linkea data: ni file:", () => {
    expect(render("data:text/html,<script>alert(1)</script>").tags).not.toContain("a");
    expect(render("file:///etc/passwd").tags).not.toContain("a");
  });
});

describe("nada se vuelve markup", () => {
  it("el HTML que escriba un socio queda como texto", () => {
    const { tags, text } = render("<script>alert(1)</script>");
    expect(tags).not.toContain("script");
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("una etiqueta img con onerror tampoco se crea", () => {
    const { tags, props } = render('<img src=x onerror="alert(1)">');
    expect(tags).not.toContain("img");
    expect(props.some((p) => "onerror" in p || "onError" in p)).toBe(false);
  });

  it("ningún elemento generado recibe un manejador de eventos", () => {
    const { props } = render("**hola** [x](y) <b>z</b> https://a.com\n- item");
    const handlers = props.flatMap((p) =>
      Object.keys(p).filter((k) => /^on[A-Z]/.test(k))
    );
    expect(handlers).toEqual([]);
  });

  it("ningún elemento recibe dangerouslySetInnerHTML", () => {
    const { props } = render("## t\n**b**\n- l\nhttps://a.com");
    expect(props.some((p) => "dangerouslySetInnerHTML" in p)).toBe(false);
  });
});
