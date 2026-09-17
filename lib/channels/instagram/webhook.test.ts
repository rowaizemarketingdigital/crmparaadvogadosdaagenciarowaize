import { describe, expect, it } from "vitest";

import { parseInstagramWebhook } from "./webhook";

describe("parseInstagramWebhook", () => {
  it("ignora envelope que não é do Instagram (ex.: WhatsApp Cloud)", () => {
    expect(parseInstagramWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
  });

  it("extrai evento de comentário", () => {
    const eventos = parseInstagramWebhook({
      object: "instagram",
      entry: [
        {
          id: "1789",
          changes: [
            {
              field: "comments",
              value: { id: "comment-1", text: "quero saber mais", media: { id: "media-1" }, from: { id: "u1", username: "fulano" } },
            },
          ],
        },
      ],
    });
    expect(eventos).toEqual([
      { kind: "comment", businessId: "1789", commentId: "comment-1", mediaId: "media-1", text: "quero saber mais", fromUserId: "u1", fromUsername: "fulano" },
    ]);
  });

  it("ignora change de field diferente de comments (ex.: mentions)", () => {
    const eventos = parseInstagramWebhook({
      object: "instagram",
      entry: [{ id: "1789", changes: [{ field: "mentions", value: { id: "x" } }] }],
    });
    expect(eventos).toEqual([]);
  });

  it("extrai DM comum", () => {
    const eventos = parseInstagramWebhook({
      object: "instagram",
      entry: [
        { id: "1789", messaging: [{ sender: { id: "u1" }, message: { mid: "m1", text: "oi" } }] },
      ],
    });
    expect(eventos).toEqual([
      { kind: "dm", businessId: "1789", messageId: "m1", senderId: "u1", text: "oi", quickReplyPayload: null, storyReplyId: null, isEcho: false },
    ]);
  });

  it("extrai quick reply e resposta de story", () => {
    const eventos = parseInstagramWebhook({
      object: "instagram",
      entry: [
        {
          id: "1789",
          messaging: [
            {
              sender: { id: "u1" },
              message: { mid: "m2", quick_reply: { payload: "automation:abc" }, reply_to: { story: { id: "story-1" } } },
            },
          ],
        },
      ],
    });
    expect(eventos[0]).toMatchObject({ quickReplyPayload: "automation:abc", storyReplyId: "story-1" });
  });

  it("marca eco da própria conta", () => {
    const eventos = parseInstagramWebhook({
      object: "instagram",
      entry: [{ id: "1789", messaging: [{ sender: { id: "u1" }, message: { mid: "m3", is_echo: true } }] }],
    });
    expect(eventos[0]).toMatchObject({ isEcho: true });
  });

  it("descarta comentário sem id (payload fora do esperado)", () => {
    const eventos = parseInstagramWebhook({
      object: "instagram",
      entry: [{ id: "1789", changes: [{ field: "comments", value: { text: "sem id" } }] }],
    });
    expect(eventos).toEqual([]);
  });
});
