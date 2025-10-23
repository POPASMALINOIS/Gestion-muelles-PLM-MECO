import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, FileUp, Plus, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";

/**
 * MECO – Gestión de Muelles (WEB)
 * --------------------------------------------------------------------------
 * Cambios solicitados:
 *  - Eliminado el botón "SLA Espera" en la summary bar superior.
 *  - Eliminada cualquier coloración roja/amarilla en las filas por “SALIDA TOPE”.
 *    (La tabla se muestra limpia; NO se aplica resalte por proximidad a tiempos).
 *
 * Funcionalidad:
 *  - Importa .xlsx con columnas base: TRANSPORTISTA, MATRICULA, DESTINO, LLEGADA,
 *    SALIDA, SALIDA TOPE, OBSERVACIONES (se aceptan alias y mayúsculas/acentos).
 *  - Campos extra editables: MUELLE, PRECINTO, LLEGADA REAL, SALIDA REAL, INCIDENCIAS, ESTADO.
 *  - 10 pestañas de “Lado 0” a “Lado 9”.
 *  - Vista de muelles (colores por estado de muelle): Verde=Libre, Amarillo=Espera, Rojo=Ocupado.
 *  - Estados de camión: OK, CARGANDO, ANULADO (con filtro).
 *  - Click en muelle abre panel lateral con detalle de asignación.
 *  - Persistencia localStorage + difusión opcional con BroadcastChannel y WebSocket (window.MECO_WS_URL).
 *  - UI con stubs de shadcn/ui + Tailwind (componentes en src/components/ui/*).
 * --------------------------------------------------------------------------
 */

// --------------------------- Constantes y utilidades ---------------------------
const DOCKS = [
  312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,
  351,352,353,354,355,356,357,359,360,361,362,363,364,365,366,367,368,369,
];

const LADOS = Array.from({ length: 10 }, (_, i) => `Lado ${i}`);

const INCIDENTES = [
  "RETRASO TRANSPORTISTA",
  "RETRASO CD",
  "RETRASO DOCUMENTACION",
  "CAMION ANULADO",
  "CAMION NO APTO",
];

const CAMION_ESTADOS = [
  { key: "OK", label: "OK", color: "bg-emerald-600" },
  { key: "CARGANDO", label: "CARGANDO", color: "bg-amber-500" },
  { key: "ANULADO", label: "ANULADO", color: "bg-red-600" },
];

const HEADER_ALIASES: Record<string, string> = {
  transportista: "TRANSPORTISTA",
  transporte: "TRANSPORTISTA",
  carrier: "TRANSPORTISTA",
  matricula: "MATRICULA",
  matrícula: "MATRICULA",
  placa: "MATRICULA",
  destino: "DESTINO",
  llegada: "LLEGADA",
  entrada: "LLEGADA",
  salida: "SALIDA",
  "salida tope": "SALIDA TOPE",
  cierre: "SALIDA TOPE",
  observaciones: "OBSERVACIONES",
};

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}
function mapHeader(name: string) {
  const n = norm(name);
  return HEADER_ALIASES[n] || name.toUpperCase();
}
function nowISO() {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: tz,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

// ---------------------------- Persistencia local ----------------------------
function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// ------------------------------ Tipado de filas -----------------------------
export type OperativaRow = {
  id: string;
  TRANSPORTISTA?: string;
  MATRICULA?: string;
  DESTINO?: string;
  LLEGADA?: string; // planificada
  SALIDA?: string;  // planificada
  "SALIDA TOPE"?: string;
  OBSERVACIONES?: string;
  // extras editables
  MUELLE?: number | "";
  PRECINTO?: string;
  "LLEGADA REAL"?: string;
  "SALIDA REAL"?: string;
  INCIDENCIAS?: string;
  ESTADO?: "OK" | "CARGANDO" | "ANULADO";
};

export type LadoState = {
  name: string; // "Lado X"
  rows: OperativaRow[];
};

export type AppState = {
  lados: Record<string, LadoState>;
};

// ----------------------------- Comunicación RT -----------------------------
function useRealtimeSync(state: AppState, setState: (s: AppState) => void) {
  const bcRef = useRef<BroadcastChannel | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("meco-docks"); } catch {}
    const bc = bcRef.current;
    const onMsg = (ev: MessageEvent) => {
      const anyData: any = (ev as any)?.data;
      if (anyData?.type === "APP_STATE") setState(anyData.payload);
    };
    bc?.addEventListener("message", onMsg as any);
    return () => bc?.removeEventListener("message", onMsg as any);
  }, [setState]);

  useEffect(() => {
    const url = (window as any).MECO_WS_URL as string | undefined;
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      try { ws.send(JSON.stringify({ type: "HELLO", role: "client" })); } catch {}
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === "APP_STATE") setState(msg.payload);
      } catch {}
    };
    return () => { try { ws.close(); } catch {} };
  }, [setState]);

  useEffect(() => {
    try { bcRef.current?.postMessage({ type: "APP_STATE", payload: state }); } catch {}
    try { wsRef.current?.send(JSON.stringify({ type: "APP_STATE", payload: state })); } catch {}
  }, [state]);
}

// ---------------------------- Derivación de muelles -------------------------
export type DockState = "LIBRE" | "ESPERA" | "OCUPADO";

function deriveDocks(lados: Record<string, LadoState>) {
  const dockMap = new Map<number, { state: DockState; row?: OperativaRow; lado?: string }>();
  DOCKS.forEach((d) => dockMap.set(d, { state: "LIBRE" }));

  for (const ladoName of Object.keys(lados)) {
    for (const row of lados[ladoName].rows) {
      const mu = row.MUELLE as number | undefined;
      if (!mu) continue;
      const llegadaReal = (row["LLEGADA REAL"] || "").trim();
      const salidaReal = (row["SALIDA REAL"] || "").trim();

      let state: DockState = "ESPERA"; // asignado pero sin llegada
      if (llegadaReal) state = "OCUPADO";
      if (salidaReal) state = "LIBRE"; // salida libera muelle

      if (state !== "LIBRE") {
        dockMap.set(mu, { state, row, lado: ladoName });
      } else {
        if (dockMap.has(mu)) {
          const prev = dockMap.get(mu)!;
          if (prev.state !== "OCUPADO") dockMap.set(mu, { state: "LIBRE" });
        }
      }
    }
  }
  return dockMap;
}

function dockColor(state: DockState) {
  if (state === "LIBRE") return "bg-emerald-500";
  if (state === "ESPERA") return "bg-amber-500";
  return "bg-red-600"; // OCUPADO
}

// ------------------------------- Tabla editable ----------------------------
const BASE_HEADERS = [
  "TRANSPORTISTA",
  "MATRICULA",
  "DESTINO",
  "LLEGADA",
  "SALIDA",
  "SALIDA TOPE",
  "OBSERVACIONES",
];
const EXTRA_HEADERS = [
  "MUELLE",
  "PRECINTO",
  "LLEGADA REAL",
  "SALIDA REAL",
  "INCIDENCIAS",
  "ESTADO",
];
const ALL_HEADERS = [...BASE_HEADERS, ...EXTRA_HEADERS];

function EditableCell({
  value,
  onChange,
  type = "text",
  className = "",
  options,
}: {
  value: any;
  onChange: (v: any) => void;
  type?: "text" | "number" | "select";
  className?: string;
  options?: string[];
}) {
  if (type === "select" && options) {
    return (
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className={`h-8 ${className}`}>
          <SelectValue placeholder="Seleccionar" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      value={value ?? ""}
      onChange={(e: any) => onChange(e.target.value)}
      className={`h-8 ${className}`}
      type={type === "number" ? "number" : "text"}
    />
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
      {title}
    </div>
  );
}

function Toolbar({
  onImport,
  onAddRow,
  onClear,
  filterEstado,
  setFilterEstado,
  onExport,
}: {
  onImport: (file: File) => void;
  onAddRow: () => void;
  onClear: () => void;
  filterEstado: string;
  setFilterEstado: (s: string) => void;
  onExport: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />
      <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
        <FileUp className="mr-2 h-4 w-4" /> Importar Excel
      </Button>
      <Button size="sm" onClick={onExport}>
        <Download className="mr-2 h-4 w-4" /> Exportar CSV
      </Button>
      <Button size="sm" variant="outline" onClick={onAddRow}>
        <Plus className="mr-2 h-4 w-4" /> Nueva fila
      </Button>
      <Button size="sm" variant="destructive" onClick={onClear}>
        <Trash2 className="mr-2 h-4 w-4" /> Vaciar lado
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar estado</span>
        <Select value={filterEstado} onValueChange={setFilterEstado}>
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos</SelectItem>
            {CAMION_ESTADOS.map((e) => (
              <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ------------------------------- Componente App -----------------------------
export default function MecoDockManager() {
  const [app, setApp] = useLocalStorage<AppState>("meco-app", {
    lados: Object.fromEntries(LADOS.map((n) => [n, { name: n, rows: [] }])) as Record<string, LadoState>,
  });

  const [active, setActive] = useState<string>(LADOS[0]);
  const [filterEstado, setFilterEstado] = useState<string>("TODOS");
  const [clock, setClock] = useState(nowISO());
  const [panel, setPanel] = useState<{ open: boolean; dock?: number; info?: { row?: OperativaRow; lado?: string } }>({
    open: false,
  });

  useRealtimeSync(app, setApp);

  useEffect(() => {
    const t = setInterval(() => setClock(nowISO()), 1000);
    return () => clearInterval(t);
  }, []);

  const docks = useMemo(() => deriveDocks(app.lados), [app]);

  function updateRow(lado: string, id: string, patch: Partial<OperativaRow>) {
    setApp((prev) => {
      const rows = prev.lados[lado].rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
      return { ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } } };
    });
  }

  function addRow(lado: string) {
    const newRow: OperativaRow = {
      id: crypto.randomUUID(),
      ESTADO: "OK",
    };
    setApp((prev) => ({
      ...prev,
      lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: [newRow, ...prev.lados[lado].rows] } },
    }));
  }

  function removeRow(lado: string, id: string) {
    setApp((prev) => ({
      ...prev,
      lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: prev.lados[lado].rows.filter((r) => r.id !== id) } },
    }));
  }

  function clearLado(lado: string) {
    setApp((prev) => ({ ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: [] } } }));
  }

  function importExcel(file: File, lado: string) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const rows: OperativaRow[] = json.map((row) => {
        const mapped: any = {};
        for (const k of Object.keys(row)) {
          const mk = mapHeader(k);
          mapped[mk] = row[k];
        }
        for (const h of ALL_HEADERS) if (!(h in mapped)) mapped[h] = "";
        return {
          id: crypto.randomUUID(),
          ...mapped,
          ESTADO: mapped.ESTADO || "OK",
        } as OperativaRow;
      });

      setApp((prev) => ({
        ...prev,
        lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } },
      }));
    };
    reader.readAsArrayBuffer(file);
  }

  function exportCSV(lado: string) {
    const rows = app.lados[lado].rows;
    const headers = ALL_HEADERS;
    const csv = [headers.join(",")].concat(
      rows.map((r) => headers.map((h) => (r as any)[h] ?? "").join(","))
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${lado.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function filteredRows(lado: string) {
    const list = app.lados[lado].rows;
    if (filterEstado === "TODOS") return list;
    return list.filter((r) => (r.ESTADO || "OK") === filterEstado);
  }

  const legend = (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-500" /> Libre</div>
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-500" /> Espera</div>
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-600" /> Ocupado</div>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="w-full min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white">
        {/* Header limpio sin botón SLA */}
        <header className="flex items-center gap-2 justify-between mb-4">
          <h1 className="text-2xl font-bold tracking-tight">PLMECO · Gestión de Muelles</h1>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Fecha y hora</div>
            <div className="font-medium">{clock}</div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Columna izquierda: pestañas + tabla */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle>Operativas por lado</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={active} onValueChange={setActive}>
                <TabsList className="flex flex-wrap">
                  {LADOS.map((n) => (
                    <TabsTrigger key={n} value={n} className="px-3">{n}</TabsTrigger>
                  ))}
                </TabsList>

                <div className="mt-3">
                  <Toolbar
                    onImport={(f) => importExcel(f, active)}
                    onAddRow={() => addRow(active)}
                    onClear={() => clearLado(active)}
                    filterEstado={filterEstado}
                    setFilterEstado={setFilterEstado}
                    onExport={() => exportCSV(active)}
                  />
                </div>

                {LADOS.map((n) => (
                  <TabsContent key={n} value={n} className="mt-4">
                    <div className="border rounded-xl overflow-hidden">
                      {/* Cabecera de tabla */}
                      <div className="grid grid-cols-12 gap-px bg-slate-200">
                        {ALL_HEADERS.map((h) => (
                          <div key={h} className="col-span-2 bg-slate-50 p-2"><Header title={h} /></div>
                        ))}
                        <div className="col-span-1 bg-slate-50 p-2"><Header title="Acciones" /></div>
                      </div>
                      {/* Filas (sin coloraciones SLA) */}
                      <ScrollArea className="h-[48vh]">
                        {filteredRows(n).map((row) => (
                          <div key={row.id} className="grid grid-cols-12 gap-px bg-slate-200">
                            {ALL_HEADERS.map((h) => {
                              const isNumber = h === "MUELLE";
                              const isEstado = h === "ESTADO";
                              const isInc = h === "INCIDENCIAS";
                              const cellType: "text" | "number" | "select" =
                                isNumber ? "number" : (isEstado || isInc) ? "select" : "text";
                              const options =
                                isEstado ? CAMION_ESTADOS.map((e) => e.key) :
                                isInc ? INCIDENTES : undefined;

                              return (
                                <div key={h} className="col-span-2 bg-white p-1.5">
                                  <EditableCell
                                    value={(row as any)[h]}
                                    type={cellType}
                                    options={options}
                                    onChange={(v) => {
                                      if (h === "MUELLE") {
                                        const val = String(v).trim();
                                        if (!val) return updateRow(n, row.id, { MUELLE: "" });
                                        const num = Number(val);
                                        if (!DOCKS.includes(num)) return; // ignora inválidos
                                        return updateRow(n, row.id, { MUELLE: num });
                                      }
                                      if (h === "ESTADO") return updateRow(n, row.id, { ESTADO: v as any });
                                      if (h === "INCIDENCIAS") return updateRow(n, row.id, { INCIDENCIAS: v });
                                      updateRow(n, row.id, { [h]: v } as any);
                                    }}
                                  />
                                </div>
                              );
                            })}
                            <div className="col-span-1 bg-white p-1.5 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeRow(n, row.id)}
                                title="Eliminar fila"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* Columna derecha: mapa de muelles */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Estado de muelles</CardTitle>
                {legend}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {DOCKS.map((d) => {
                  const info = docks.get(d)!;
                  const color = dockColor(info.state);
                  return (
                    <Tooltip key={d}>
                      <TooltipTrigger asChild>
                        <button
                          className="group w-full rounded-lg border p-2 text-left hover:bg-slate-50"
                          onClick={() => setPanel({ open: true, dock: d, info })}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{d}</span>
                            <span className={`inline-block w-3 h-3 rounded ${color}`} />
                          </div>
                          {info.row ? (
                            <div className="mt-1 text-xs text-slate-600 truncate">
                              {info.row.DESTINO || "—"} · {info.row.MATRICULA || "—"}
                            </div>
                          ) : (
                            <div className="mt-1 text-xs text-slate-400">Sin asignación</div>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs">Muelle {d} · {info.state}</div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panel lateral de muelle */}
        <Sheet open={panel.open} onOpenChange={(v: boolean) => setPanel((p) => ({ ...p, open: v }))}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Muelle {panel.dock}</SheetTitle>
            </SheetHeader>

            {panel.info?.row ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge className="bg-slate-800 text-white">{panel.info.row.ESTADO || "OK"}</Badge>
                </div>
                <div><span className="text-slate-500">Transportista:</span> <span className="font-medium">{panel.info.row.TRANSPORTISTA || "—"}</span></div>
                <div><span className="text-slate-500">Matrícula:</span> <span className="font-medium">{panel.info.row.MATRICULA || "—"}</span></div>
                <div><span className="text-slate-500">Destino:</span> <span className="font-medium">{panel.info.row.DESTINO || "—"}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-slate-500">Llegada plan.:</span> <span className="font-medium">{panel.info.row.LLEGADA || "—"}</span></div>
                  <div><span className="text-slate-500">Salida plan.:</span> <span className="font-medium">{panel.info.row.SALIDA || "—"}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-slate-500">Llegada real:</span> <span className="font-medium">{panel.info.row["LLEGADA REAL"] || "—"}</span></div>
                  <div><span className="text-slate-500">Salida real:</span> <span className="font-medium">{panel.info.row["SALIDA REAL"] || "—"}</span></div>
                </div>
                <div><span className="text-slate-500">Precinto:</span> <span className="font-medium">{panel.info.row.PRECINTO || "—"}</span></div>
                <div><span className="text-slate-500">Incidencias:</span> <span className="font-medium">{panel.info.row.INCIDENCIAS || "—"}</span></div>
                <div><span className="text-slate-500">Observaciones:</span> <span className="font-medium">{panel.info.row.OBSERVACIONES || "—"}</span></div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Este muelle no tiene camión asignado.</div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
