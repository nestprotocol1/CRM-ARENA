/**
 * Ajustes del agente.
 *
 * La página es un shell estático: las configs se cargan por API desde el
 * cliente. Así el build no toca la base (PGlite no se inicializa durante la
 * exportación) y la página sigue siendo interactiva.
 */

import { SettingsShell } from "./settings-shell";

export const metadata = { title: "Ajustes — CRM Multicanal" };

export default function SettingsPage() {
  return <SettingsShell />;
}
