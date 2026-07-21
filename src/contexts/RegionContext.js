import React, { createContext, useContext, useState } from 'react';
import { adminI18n } from './adminI18n';

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
    () => localStorage.getItem('sp-survey-language') || LANGUAGES.EN
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
    setLanguageState(l);
    localStorage.setItem('sp-survey-language', l);
  };

  const isChinaMode = region === REGIONS.CHINA;
  const t = i18n[language] || i18n.en;

  return (
    <RegionContext.Provider value={{ region, setRegion, language, setLanguage, isChinaMode, t }}>
      {children}
    </RegionContext.Provider>
  );
}

export const useRegion = () => {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion must be used within RegionProvider');
  return ctx;
};
