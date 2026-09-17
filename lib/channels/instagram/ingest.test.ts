import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { ingestInstagramInbound } from "./ingest";
import type { InstagramCommentEvent, InstagramDirectMessageEvent } from "./webhook";

function fixture(resposta: { data?: unknown; error?: { message: string } | null }) {
  const chamadas: Array<{ nome: string; args: unknown }> = [];
  const client = {
    rpc(nome: string, args: unknown) {
      chamadas.push({ nome, args });
      return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, chamadas };
}

const org = { organizationId: "org1" };

describe("ingestInstagramInbound — comentário", () => {
  it("resolve contato pelo autor do comentário, não pela conta dona da página", async () => {
    const { client, chamadas } = fixture({ data: "contact-1" });
    const evento: InstagramCommentEvent = {
      kind: "comment",
      businessId: "1789",
      commentId: "c1",
      mediaId: "m1",
      text: "quero saber mais",
      fromUserId: "u1",
      fromUsername: "fulano",
    };
    const r = await ingestInstagramInbound(client, evento, org);
    expect(r).toEqual({ status: "contact_resolved", contactId: "contact-1" });
    expect(chamadas[0]?.args).toMatchObject({ p_org: "org1", p_instagram_id: "u1", p_username: "fulano" });
  });
});

describe("ingestInstagramInbound — DM", () => {
  it("ignora eco da própria conta sem chamar o banco", async () => {
    const { client, chamadas } = fixture({ data: "contact-1" });
    const evento: InstagramDirectMessageEvent = {
      kind: "dm",
      businessId: "1789",
      messageId: "m1",
      senderId: "u1",
      text: "oi",
      quickReplyPayload: null,
      storyReplyId: null,
      isEcho: true,
    };
    const r = await ingestInstagramInbound(client, evento, org);
    expect(r).toEqual({ status: "ignored_echo" });
    expect(chamadas).toHaveLength(0);
  });

  it("resolve contato pelo remetente do DM", async () => {
    const { client, chamadas } = fixture({ data: "contact-2" });
    const evento: InstagramDirectMessageEvent = {
      kind: "dm",
      businessId: "1789",
      messageId: "m2",
      senderId: "u2",
      text: "quero um orçamento",
      quickReplyPayload: null,
      storyReplyId: null,
      isEcho: false,
    };
    const r = await ingestInstagramInbound(client, evento, org);
    expect(r).toEqual({ status: "contact_resolved", contactId: "contact-2" });
    expect(chamadas[0]?.args).toMatchObject({ p_org: "org1", p_instagram_id: "u2", p_username: null });
  });

  it("propaga falha da RPC como status failed, sem lançar", async () => {
    const { client } = fixture({ error: { message: "boom" } });
    const evento: InstagramDirectMessageEvent = {
      kind: "dm",
      businessId: "1789",
      messageId: "m3",
      senderId: "u3",
      text: null,
      quickReplyPayload: null,
      storyReplyId: null,
      isEcho: false,
    };
    const r = await ingestInstagramInbound(client, evento, org);
    expect(r).toEqual({ status: "failed", reason: "upsert_contact_failed" });
  });
});
