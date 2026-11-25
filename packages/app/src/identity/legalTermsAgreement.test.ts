import { expect, test } from "bun:test";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import {
  createLegalTermsAgreementStore,
  KEPT_LEGAL_TERMS_STORAGE_PREFIX,
} from "./legalTermsAgreement";

function memoryStorage(): Map<string, string> & {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const entries = new Map<string, string>();
  return Object.assign(entries, {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  });
}

test("a key keeps the page's agreement on the device, for the current revision only", () => {
  const storage = memoryStorage();
  const page = createLegalTermsAgreementStore(storage);
  // Nothing is kept before the person agrees.
  page.keepFor("key-a");
  expect(storage.size).toBe(0);
  expect(page.agreedVersionFor("key-a")).toBeNull();

  page.agree();
  page.keepFor("key-a");
  expect(storage.get(`${KEPT_LEGAL_TERMS_STORAGE_PREFIX}key-a`)).toBe(
    LEGAL_TERMS_VERSION,
  );
  expect(page.agreedVersionFor("key-b")).toBe(LEGAL_TERMS_VERSION);

  // After a relaunch the page has not agreed: only the kept key has.
  const relaunched = createLegalTermsAgreementStore(storage);
  expect(relaunched.agreedVersion).toBeNull();
  expect(relaunched.agreedVersionFor("key-a")).toBe(LEGAL_TERMS_VERSION);
  expect(relaunched.agreedVersionFor("key-b")).toBeNull();
  expect(relaunched.agreedVersionFor(null)).toBeNull();

  // An agreement to an earlier revision is not one to this build's.
  storage.set(`${KEPT_LEGAL_TERMS_STORAGE_PREFIX}key-c`, "2000-01-01");
  expect(relaunched.agreedVersionFor("key-c")).toBeNull();
});

test("storage that refuses leaves the agreement unkept instead of failing", () => {
  const refusing = {
    getItem: (): string | null => {
      throw new Error("storage blocked");
    },
    setItem: (): void => {
      throw new Error("storage blocked");
    },
  };
  const page = createLegalTermsAgreementStore(refusing);
  expect(page.agreedVersionFor("key-a")).toBeNull();
  page.agree();
  expect(() => page.keepFor("key-a")).not.toThrow();
  expect(page.agreedVersionFor("key-a")).toBe(LEGAL_TERMS_VERSION);
  expect(createLegalTermsAgreementStore(null).agreedVersionFor("key-a")).toBe(
    null,
  );
});
