CREATE TABLE "text_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_identity_id" uuid NOT NULL,
	"content" varchar(5000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "text_messages" ADD CONSTRAINT "text_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_messages" ADD CONSTRAINT "text_messages_sender_identity_id_identities_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;