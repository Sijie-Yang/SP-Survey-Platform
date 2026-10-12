import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { adminI18n } from './adminI18n';
import { interfaceDictionary, normalizeUiLanguage } from '../lib/uiLanguages';
import { onLocaleBundleLoaded } from './localeBundles';

export const RegionContext = createContext(null);

export const REGIONS = {
  GLOBAL: 'global',
  CHINA: 'china',
};

export const LANGUAGES = {
  EN: 'en',
  ZH: 'zh',
};

export const i18n = adminI18n;

export function RegionProvider({ children }) {
  const [region, setRegionState] = useState(
    () => localStorage.getItem('sp-survey-region') || REGIONS.GLOBAL
  );
  const [language, setLanguageState] = useState(
    () => normalizeUiLanguage(localStorage.getItem('sp-survey-language') || LANGUAGES.EN)
  );

  const setRegion = (r) => {
    setRegionState(r);
    localStorage.setItem('sp-survey-region', r);
    if (r === REGIONS.CHINA) {
      setLanguageState(LANGUAGES.ZH);
      localStorage.setItem('sp-survey-language', LANGUAGES.ZH);
    } else {
      setLanguageState(LANGUAGES.EN);
      localStorage.setItem('sp-survey-language', LANGUAGES.EN);
    }
  };

  const setLanguage = (l) => {
    const next = normalizeUiLanguage(l);
    setLanguageState(next);
    localStorage.setItem('sp-survey-language', next);
  };

  // Re-render once a lazily loaded language bundle arrives (UI or survey language).
  const [bundleVersion, setBundleVersion] = useState(0);
  useEffect(() => onLocaleBundleLoaded(() => setBundleVersion((n) => n + 1)), []);

  const isChinaMode = region === REGIONS.CHINA;
  const t = useMemo(() => interfaceDictionary(language), [language, bundleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stable value keeps every useRegion() consumer from re-rendering when
  // the provider's parent re-renders.
  const value = useMemo(
    () => ({ region, setRegion, language, setLanguage, isChinaMode, t, bundleVersion }),
    [region, language, isChinaMode, t, bundleVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <RegionContext.Provider value={value}>
      {children}
    </RegionContext.Provider>
  );
}

export const useRegion = () => {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion must be used within RegionProvider');
  return ctx;
};
