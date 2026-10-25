"use client";

/**
 * Shell de ajustes: una pestaña por canal con prompt, herramientas, modelo e
 * interruptor. Las configs se cargan por API (GET /api/settings/agent-config).
 * La pestaña de cuentas (OAuth) se agrega en la Fase 6.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ChannelIcon, channelLabel } from "@/components/channel-icon";
import type { AgentConfigRow } from "@/lib/agent/graph";

const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
const ALL_TOOLS = ["handoff_human", "add_note"];

const TOOL_LABELS: Record<string, string> = {
  handoff_human: "Derivar a humano",
  add_note: "Notas internas",
};

export function SettingsShell() {
  const [configs, setConfigs] = useState<AgentConfigRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/agent-config")
      .then((r) => r.json())
      .then((data: { configs?: AgentConfigRow[] }) => setConfigs(data.configs ?? []))
      .catch(() => setError("No se pudieron cargar las configuraciones."));
  }, []);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!configs)
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando ajustes…
      </p>
    );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Ajustes del agente</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Un agente por canal, con su prompt, sus herramientas y su interruptor. Los canales
        nuevos arrancan apagados: si no, contestan con el prompt de otro canal.
      </p>

      <Tabs defaultValue="whatsapp" className="mt-6">
        <TabsList>
          {CHANNELS.map((channel) => {
            const config = configs.find((c) => c.channel === channel);
            return (
              <TabsTrigger key={channel} value={channel}>
                <ChannelIcon channel={channel} className="h-3.5 w-3.5" />
                {channelLabel(channel)}
                {config?.enabled ? (
                  <Badge variant="success" className="ml-1 h-4 px-1 text-[10px]">
                    on
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    off
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="global">Global</TabsTrigger>
        </TabsList>

        {[...CHANNELS, "global" as const].map((channel) => (
          <TabsContent key={channel} value={channel}>
            <ChannelConfigForm
              channel={channel}
              config={configs.find((c) => c.channel === channel)}
              onSaved={(savedConfig) =>
                setConfigs((current) => {
                  const next = current ?? [];
                  const index = next.findIndex((c) => c.channel === savedConfig.channel);
                  if (index >= 0) {
                    const copy = [...next];
                    copy[index] = savedConfig;
                    return copy;
                  }
                  return [...next, savedConfig];
                })
              }
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ChannelConfigForm({
  channel,
  config,
  onSaved,
}: {
  channel: string;
  config?: AgentConfigRow;
  onSaved: (config: AgentConfigRow) => void;
}) {
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [tools, setTools] = useState<string[]>(
    config?.enabledTools ?? ["handoff_human", "add_note"],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/agent-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel,
          enabled,
          systemPrompt,
          model: model || undefined,
          enabledTools: tools,
        }),
      });
      const data = (await response.json()) as { configs?: AgentConfigRow[] };
      const savedConfig = data.configs?.find((c) => c.channel === channel);
      if (savedConfig) onSaved(savedConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [channel, enabled, systemPrompt, model, tools, onSaved]);

  return (
    <div className="mt-4 space-y-5 rounded-xl border p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">
            {channel === "global"
              ? "Configuración global"
              : `Agente de ${channelLabel(channel)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {channel === "global"
              ? "Segundo eslabón de la cascada: canal -> global -> default del código."
              : "Interruptor del canal. Con la conversación en pausa, un vendedor puede tomar el hilo."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {enabled ? "Prendido" : "Apagado"}
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Interruptor del canal"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Prompt del sistema</label>
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="Ej: Sos el asistente de ventas por WhatsApp. Respondés en español, tono cercano y concreto…"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Modelo (OpenRouter)</label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="openai/gpt-4o-mini"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Herramientas</label>
        <div className="flex gap-4">
          {ALL_TOOLS.map((tool) => (
            <label key={tool} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tools.includes(tool)}
                onChange={(e) =>
                  setTools((current) =>
                    e.target.checked ? [...current, tool] : current.filter((t) => t !== tool),
                  )
                }
                className="h-4 w-4"
              />
              {TOOL_LABELS[tool] ?? tool}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-600">
            <Check className="h-4 w-4" /> Guardado
          </span>
        )}
      </div>
    </div>
  );
}
