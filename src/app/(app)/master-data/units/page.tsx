"use client";

import { useState } from "react";
import { Ruler, Plus, ArrowRight, Trash2, Save, Repeat } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { forgetUnits } from "@/components/ui/uom-options";
import { procurement } from "@/demo/api";
import {
  UOM_DIMENSIONS, type Uom, type UomConversion, type UomDimension,
} from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** Units of measure, and how they convert.
 *
 *  Every quantity in the system is written in one of these — request lines,
 *  orders, ledger lines, stock moves — so a unit's **code never changes** once
 *  it exists; only its name and dimension can be corrected. A unit is deleted
 *  only when nothing is measured in it, and the refusal says what still is.
 *
 *  A conversion is stored once, in one direction: `lusin → pcs = 12`. Its
 *  reverse is the same fact, so the second copy is refused rather than kept to
 *  one day disagree with the first.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type UnitForm = { mode: "create" | "edit"; code: string; name: string; dimension: UomDimension };
type ConvForm = {
  mode: "create" | "edit"; from_uom: string; to_uom: string;
  factor: string; yield_ratio: string; note: string;
};

export default function UnitsPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("procurement.update");
  const [units, reloadUnits] = useLoad(() => procurement.listUom(), []);
  const [convs, reloadConvs] = useLoad(() => procurement.listUomConversions(), []);
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null);
  const [convForm, setConvForm] = useState<ConvForm | null>(null);
  const [saving, setSaving] = useState(false);

  const unitList = units.status === "ready" ? units.data : [];

  async function saveUnit() {
    if (!unitForm) return;
    setSaving(true);
    const res = unitForm.mode === "create"
      ? await procurement.createUom({ code: unitForm.code, name: unitForm.name, dimension: unitForm.dimension })
      : await procurement.updateUom(unitForm.code, { name: unitForm.name, dimension: unitForm.dimension });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not saved", res.error.message);
      return;
    }
    toast("success", unitForm.mode === "create" ? "Unit added" : "Unit updated",
      `${res.data.code} — ${res.data.name}`);
    forgetUnits();
    setUnitForm(null);
    reloadUnits();
  }

  async function deleteUnit(code: string) {
    setSaving(true);
    const res = await procurement.deleteUom(code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not deleted", res.error.message);
      return;
    }
    toast("success", "Unit deleted", `"${code}" is gone. Nothing was measured in it.`);
    forgetUnits();
    setUnitForm(null);
    reloadUnits();
  }

  async function saveConv() {
    if (!convForm) return;
    const factor = Number(convForm.factor);
    const yieldRatio = convForm.yield_ratio.trim() === "" ? null : Number(convForm.yield_ratio);
    setSaving(true);
    const res = await procurement.saveUomConversion({
      from_uom: convForm.from_uom, to_uom: convForm.to_uom, factor,
      yield_ratio: yieldRatio, note: convForm.note,
    });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not saved", res.error.message);
      return;
    }
    toast("success", "Conversion saved", `1 ${res.data.from_uom} = ${res.data.factor} ${res.data.to_uom}`);
    setConvForm(null);
    reloadConvs();
  }

  async function deleteConv(fromUom: string, toUom: string) {
    setSaving(true);
    const res = await procurement.deleteUomConversion(fromUom, toUom);
    setSaving(false);
    if (res.error) { toast("critical", "Not deleted", res.error.message); return; }
    toast("success", "Conversion deleted", `${fromUom} → ${toUom}`);
    setConvForm(null);
    reloadConvs();
  }

  const unitColumns: Column<Uom>[] = [
    { key: "code", header: "Code", render: (u) => <span className="font-mono text-[13px] font-medium text-slate-800">{u.code}</span> },
    { key: "name", header: "Name", render: (u) => u.name },
    { key: "dim", header: "Dimension", render: (u) => <Badge tone="slate">{u.dimension}</Badge> },
  ];

  const convColumns: Column<UomConversion>[] = [
    {
      key: "pair",
      header: "Conversion",
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-slate-800">
          1 {c.from_uom} <ArrowRight className="h-3.5 w-3.5 text-slate-400" /> {c.factor} {c.to_uom}
        </span>
      ),
    },
    {
      key: "yield",
      header: "Yield",
      align: "right",
      render: (c) => c.yield_ratio == null
        ? <span className="text-slate-300">—</span>
        : `${Math.round(c.yield_ratio * 100)}%`,
    },
    {
      key: "note",
      header: "Note",
      className: "whitespace-normal",
      render: (c) => c.note ?? <span className="text-slate-300">—</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Master Data"
        title="Units"
        description="Every quantity in the system is written in one of these units. A unit's code never changes once created; a unit can be deleted only while nothing is measured in it."
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setUnitForm({ mode: "create", code: "", name: "", dimension: "count" })}>
            Add unit
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Units of measure"
            subtitle={units.status === "ready" ? `${units.data.length} units` : undefined}
            icon={Ruler}
            action={<SourceBadge state={units} />}
          />
          <Loaded state={units} onRetry={reloadUnits}>
            {(rows) => (
              <DataTable
                dense
                columns={unitColumns}
                rows={rows}
                rowKey={(u) => u.code}
                onRowClick={mayEdit
                  ? (u) => setUnitForm({ mode: "edit", code: u.code, name: u.name, dimension: u.dimension })
                  : undefined}
                empty="No units yet."
              />
            )}
          </Loaded>
        </Card>

        <Card>
          <CardHeader
            title="Conversions"
            subtitle="Stored once, in one direction. Yield is for conversions that lose material, like log to board."
            icon={Repeat}
            action={mayEdit && (
              <Button
                size="sm"
                variant="outline"
                icon={Plus}
                className="shrink-0 whitespace-nowrap"
                onClick={() => setConvForm({
                  mode: "create", from_uom: unitList[0]?.code ?? "", to_uom: unitList[1]?.code ?? "",
                  factor: "", yield_ratio: "", note: "",
                })}
              >
                Add conversion
              </Button>
            )}
          />
          <Loaded state={convs} onRetry={reloadConvs}>
            {(rows) => (
              <DataTable
                dense
                columns={convColumns}
                rows={rows}
                rowKey={(c) => c.id}
                onRowClick={mayEdit
                  ? (c) => setConvForm({
                    mode: "edit", from_uom: c.from_uom, to_uom: c.to_uom,
                    factor: String(c.factor), yield_ratio: c.yield_ratio == null ? "" : String(c.yield_ratio),
                    note: c.note ?? "",
                  })
                  : undefined}
                empty="No conversions yet."
              />
            )}
          </Loaded>
        </Card>
      </div>

      <Modal
        open={!!unitForm}
        onClose={() => setUnitForm(null)}
        title={unitForm?.mode === "create" ? "Add unit" : `Edit unit ${unitForm?.code ?? ""}`}
      >
        {unitForm && (
          <div className="space-y-3 text-sm">
            <div>
              <label htmlFor="uom-code" className="block text-xs text-slate-500">Code</label>
              <input
                id="uom-code"
                value={unitForm.code}
                disabled={unitForm.mode === "edit"}
                onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value.toLowerCase() })}
                placeholder="e.g. carton"
                className={`${inputClass} font-mono disabled:bg-slate-50 disabled:text-slate-500`}
              />
              <p className="mt-1 text-xs text-slate-500">
                {unitForm.mode === "create"
                  ? "Short, lower-case, no spaces. It cannot be changed later — every line written in it keeps it."
                  : "The code cannot be changed: every line ever written in this unit uses it."}
              </p>
            </div>
            <div>
              <label htmlFor="uom-name" className="block text-xs text-slate-500">Name</label>
              <input
                id="uom-name"
                value={unitForm.name}
                onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                placeholder="e.g. Carton"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="uom-dim" className="block text-xs text-slate-500">Dimension</label>
              <select
                id="uom-dim"
                value={unitForm.dimension}
                onChange={(e) => setUnitForm({ ...unitForm, dimension: e.target.value as UomDimension })}
                className={inputClass}
              >
                {UOM_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              {unitForm.mode === "edit" ? (
                <Button variant="outline" icon={Trash2} onClick={() => deleteUnit(unitForm.code)} disabled={saving}>
                  Delete
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setUnitForm(null)}>Cancel</Button>
                <Button
                  icon={Save}
                  onClick={saveUnit}
                  disabled={saving || !unitForm.code.trim() || !unitForm.name.trim()}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!convForm}
        onClose={() => setConvForm(null)}
        title={convForm?.mode === "create" ? "Add conversion" : "Edit conversion"}
      >
        {convForm && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <label htmlFor="conv-from" className="block text-xs text-slate-500">1 of</label>
                <select
                  id="conv-from"
                  value={convForm.from_uom}
                  disabled={convForm.mode === "edit"}
                  onChange={(e) => setConvForm({ ...convForm, from_uom: e.target.value })}
                  className={`${inputClass} disabled:bg-slate-50`}
                >
                  {unitList.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                </select>
              </div>
              <ArrowRight className="mb-2.5 h-4 w-4 text-slate-400" />
              <div>
                <label htmlFor="conv-to" className="block text-xs text-slate-500">equals, in</label>
                <select
                  id="conv-to"
                  value={convForm.to_uom}
                  disabled={convForm.mode === "edit"}
                  onChange={(e) => setConvForm({ ...convForm, to_uom: e.target.value })}
                  className={`${inputClass} disabled:bg-slate-50`}
                >
                  {unitList.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="conv-factor" className="block text-xs text-slate-500">Factor</label>
              <input
                id="conv-factor"
                inputMode="decimal"
                value={convForm.factor}
                onChange={(e) => setConvForm({ ...convForm, factor: e.target.value })}
                placeholder="e.g. 12"
                className={inputClass}
              />
              {convForm.factor && Number(convForm.factor) > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  1 {convForm.from_uom} = {convForm.factor} {convForm.to_uom}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="conv-yield" className="block text-xs text-slate-500">Yield (optional, 0–1)</label>
              <input
                id="conv-yield"
                inputMode="decimal"
                value={convForm.yield_ratio}
                onChange={(e) => setConvForm({ ...convForm, yield_ratio: e.target.value })}
                placeholder="Only when material is lost, e.g. 0.52"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="conv-note" className="block text-xs text-slate-500">Note</label>
              <input
                id="conv-note"
                value={convForm.note}
                onChange={(e) => setConvForm({ ...convForm, note: e.target.value })}
                placeholder="e.g. screws, per factory box"
                className={inputClass}
              />
            </div>
            <div className="flex justify-between gap-2 pt-2">
              {convForm.mode === "edit" ? (
                <Button
                  variant="outline"
                  icon={Trash2}
                  onClick={() => deleteConv(convForm.from_uom, convForm.to_uom)}
                  disabled={saving}
                >
                  Delete
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setConvForm(null)}>Cancel</Button>
                <Button
                  icon={Save}
                  onClick={saveConv}
                  disabled={saving || !(Number(convForm.factor) > 0) || convForm.from_uom === convForm.to_uom}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
