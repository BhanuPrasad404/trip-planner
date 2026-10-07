import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { anthropicApiKey, cleanEnv, diagnoseAnthropic, inspectEnvFiles } from "@/lib/config";

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(path.join(tmpdir(), "tm-env-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(d, name), body);
  return d;
};

describe("cleanEnv", () => {
  it("trims, strips quotes, and treats placeholders as not set", () => {
    expect(cleanEnv("  sk-ant-abc  ")).toBe("sk-ant-abc");
    expect(cleanEnv('"sk-ant-abc"')).toBe("sk-ant-abc");
    expect(cleanEnv("")).toBeNull();
    expect(cleanEnv("   ")).toBeNull();
    expect(cleanEnv(undefined)).toBeNull();
    expect(cleanEnv("YOUR-KEY-HERE")).toBeNull();
    expect(cleanEnv("sk-ant-...")).toBeNull();
  });
  it("only the right variable name counts (a NEXT_PUBLIC_ copy is not the key)", () => {
    expect(anthropicApiKey({ NEXT_PUBLIC_ANTHROPIC_API_KEY: "sk-ant-x" })).toBeNull();
    expect(anthropicApiKey({ ANTHROPIC_API_KEY: " sk-ant-x " })).toBe("sk-ant-x");
  });
});

describe("inspectEnvFiles (never reads the value out)", () => {
  it("sees a key line with a value, an empty line, and misnamed files", () => {
    expect(inspectEnvFiles("ANTHROPIC_API_KEY", dir({ ".env.local": "A=1\nANTHROPIC_API_KEY=sk-ant-real\n" }))).toMatchObject({ localHasValue: true, localHasEmptyLine: false, present: [".env.local"] });
    expect(inspectEnvFiles("ANTHROPIC_API_KEY", dir({ ".env.local": "ANTHROPIC_API_KEY=\n" }))).toMatchObject({ localHasValue: false, localHasEmptyLine: true });
    expect(inspectEnvFiles("ANTHROPIC_API_KEY", dir({ ".env.local.txt": "x" }))).toMatchObject({ misnamed: [".env.local.txt"], present: [] });
    expect(inspectEnvFiles("ANTHROPIC_API_KEY", dir({}))).toMatchObject({ localHasValue: false, present: [] });
  });
});

describe("diagnoseAnthropic: says WHY the running server has no key, and the exact next step", () => {
  const files = (o: Partial<ReturnType<typeof inspectEnvFiles>> = {}) => ({ present: [], misnamed: [], localHasValue: false, localHasEmptyLine: false, ...o });
  const why = (env: Record<string, string>, f = files(), production = false) => diagnoseAnthropic(env, f, production);

  it("is fine when the key is set", () => {
    expect(why({ ANTHROPIC_API_KEY: "sk-ant-x" })).toMatchObject({ ok: true, problem: null });
  });
  it("warns when a key is set but looks like the wrong kind", () => {
    expect(why({ ANTHROPIC_API_KEY: "abc123" }).problem).toMatch(/sk-ant-/);
  });
  it("the most common case: the key is in .env.local but the server was not restarted", () => {
    const d = why({}, files({ present: [".env.local"], localHasValue: true }));
    expect(d.ok).toBe(false);
    expect(d.problem).toMatch(/IS in \.env\.local/);
    expect(d.fix).toMatch(/Ctrl \+ C/);
    expect(d.fix).toMatch(/npm run dev/);
  });
  it("Windows hidden file extension: .env.local.txt", () => {
    expect(why({}, files({ misnamed: [".env.local.txt"] })).fix).toMatch(/File name extensions/);
  });
  it("no env file at all", () => expect(why({}).fix).toMatch(/Copy \.env\.local\.example/));
  it("env file without the line", () => expect(why({}, files({ present: [".env.local"] })).problem).toMatch(/does not contain/));
  it("empty or placeholder value", () => {
    expect(why({ ANTHROPIC_API_KEY: "YOUR-KEY" }, files({ present: [".env.local"], localHasEmptyLine: true })).problem).toMatch(/no real value/);
  });
  it("production: tells you to use the hosting dashboard, not a file", () => {
    expect(why({}, files(), true).fix).toMatch(/Environment Variables/);
  });
  it("a NEXT_PUBLIC_ key is flagged as exposed, with advice to rotate it", () => {
    const d = why({ NEXT_PUBLIC_ANTHROPIC_API_KEY: "sk-ant-leak" });
    expect(d.problem).toMatch(/every visitor/);
    expect(d.fix).toMatch(/create a new key/);
  });
  it("never includes the key value anywhere", () => {
    expect(JSON.stringify(why({ ANTHROPIC_API_KEY: "sk-ant-SECRET123" }))).not.toContain("SECRET123");
    expect(JSON.stringify(why({ NEXT_PUBLIC_ANTHROPIC_API_KEY: "sk-ant-SECRET123" }))).not.toContain("SECRET123");
  });
});
