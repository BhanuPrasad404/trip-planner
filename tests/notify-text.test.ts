import { describe, expect, it } from "vitest";
import { notificationText } from "@/lib/feed/notify-text";

describe("notification sentences", () => {
  it("say who did what and where", () => {
    expect(notificationText({ kind: "like", actor: "ravi", destination: "Matheran" })).toBe("@ravi liked your post in Matheran");
    expect(notificationText({ kind: "comment", actor: "ravi", destination: "Matheran" })).toBe("@ravi commented on your post in Matheran");
    expect(notificationText({ kind: "reply", actor: "ravi", destination: "Matheran" })).toBe("@ravi replied to your comment in Matheran");
  });
  it("helpful names the person; a trip add never does (planning is private)", () => {
    expect(notificationText({ kind: "helpful", actor: "asha", destination: "Matheran" })).toBe("@asha found your post in Matheran helpful");
    expect(notificationText({ kind: "trip_add", actor: "asha", destination: "Matheran" })).toBe("A traveler added your post in Matheran to their trip");
  });
  it("never show a blank name or a dangling 'in'", () => {
    expect(notificationText({ kind: "like", actor: null, destination: null })).toBe("A traveler liked your post");
  });
});
