import { useState } from "react";

/**
 * Una sección por división, colapsable.
 *
 * Compartido por Fixture, Tablas y Citados: las tres pantallas del portal
 * multidivisión ordenan igual (propia primero para el jugador) y muestran la
 * primera abierta, el resto colapsado — un club con ocho divisiones no cabe
 * legible de otra forma.
 */
export default function DivisionAccordion({
  divisionId,
  title,
  defaultOpen,
  badge,
  children,
}: {
  divisionId: string;
  title: string;
  defaultOpen: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="bg-surface rounded-xl overflow-hidden mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex-1 text-sm font-semibold text-ink truncate">{title}</span>
        {badge}
        <span
          className={`text-ink-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && <div className="border-t border-line" data-division-id={divisionId}>{children}</div>}
    </section>
  );
}
