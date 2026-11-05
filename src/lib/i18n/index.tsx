"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { en, DictKey } from "@/lib/i18n/en";
import { am as amDict } from "@/lib/i18n/am";
import { om as omDict } from "@/lib/i18n/om";

export type Language = "en" | "am" | "om";

const DICTS: Record<Language, Partial<Record<DictKey, string>>> = {
  en,
  am: amDict,
  om: omDict,
};

interface I18nContextValue {
  language: Language;
  setLanguage: (l: Language) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>("en");

  useEffect(() => {
    // SSR-safe hydration: render English on the server, restore the stored
    // language after mount (text is fully client-localized below).
    const stored = window.localStorage.getItem("gadaa-language") as Language | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage restore before paint
    if (stored && DICTS[stored]) setLang(stored);
  }, []);

  const setLanguage = useCallback((l: Language) => {
    setLang(l);
    window.localStorage.setItem("gadaa-language", l);
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => {
      let text = DICTS[language]?.[key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return text;
    },
    [language]
  );

  return <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
