CREATE TYPE "public"."account_status" AS ENUM('connected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'instagram', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'template', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'reaction', 'other');--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"channel" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"enabled_tools" text[] DEFAULT '{handoff_human,add_note}'::text[] NOT NULL,
	"model" text DEFAULT 'openai/gpt-4o-mini' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'zernio' NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"status" "account_status" DEFAULT 'connected' NOT NULL,
	"metadata" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"picture" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "channel" NOT NULL,
	"provider" text DEFAULT 'zernio' NOT NULL,
	"external_id" text NOT NULL,
	"account_id" text NOT NULL,
	"participant_id" text,
	"name" text,
	"handle" text,
	"picture" text,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"provider" text DEFAULT 'zernio' NOT NULL,
	"external_id" text,
	"direction" "message_direction" NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body" text,
	"status" "message_status" DEFAULT 'sent' NOT NULL,
	"raw_payload" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"account_id" text,
	"status" text DEFAULT 'claimed' NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_external_id_uq" ON "channel_accounts" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_channel_external_id_uq" ON "contact_identities" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX "contact_identities_contact_id_idx" ON "contact_identities" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_external_id_uq" ON "conversations" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "conversations_account_id_idx" ON "conversations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "conversations_channel_idx" ON "conversations" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_id_uq" ON "messages" USING btree ("external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
-- Semilla: un agente por canal. El canal principal arranca PRENDIDO;
-- los demás arrancan APAGADOS (regla dura: si no, contestan con el prompt
-- de otro canal). 'global' es el segundo eslabón de la cascada.
INSERT INTO "agent_configs" ("channel", "enabled", "system_prompt", "enabled_tools", "model") VALUES
  ('whatsapp',   true,  'Eres el asistente de ventas de la empresa por WhatsApp. Respondés en español, en tono cercano y concreto. Si el cliente pide hablar con una persona, usás la herramienta handoff_human.', '{handoff_human,add_note}', 'openai/gpt-4o-mini'),
  ('instagram',  false, 'Eres el community manager por Instagram DM. Respondés breve, con emojis moderados y siempre en español.', '{handoff_human,add_note}', 'openai/gpt-4o-mini'),
  ('facebook',   false, 'Eres el agente de soporte por Facebook Messenger. Respondés en español, formal pero amable.', '{handoff_human,add_note}', 'openai/gpt-4o-mini'),
  ('global',     false, 'Sos un asistente de atención al cliente. Respondés en español, de forma clara y breve.', '{handoff_human,add_note}', 'openai/gpt-4o-mini')
ON CONFLICT ("channel") DO NOTHING;
