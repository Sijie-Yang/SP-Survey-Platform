/**
 * Public FAQ copy. Kept out of adminI18n so other admin-string edits merge cleanly.
 * English is the fallback for every language except Simplified and Traditional Chinese.
 */
export const faqI18n = {
  en: {
    footerFaq: 'FAQ',
    faqIntroLink: 'Where data is stored, and how long a survey stays up',
    faqTitle: 'Frequently asked questions',
    faqLead: 'Where the hosted SP-Survey platform keeps data, and how long a survey and its results stay available.',
    faqWhereTitle: 'Where does the data live?',
    faqWhereBody: 'The website runs on Cloudflare. Survey designs and participant responses are stored in the project Supabase database. Media files, such as images and video, are stored in Cloudflare R2.',
    faqHowLongTitle: 'How long do a survey and its results stay up?',
    faqHowLongBody: 'There is no automatic expiry. A survey and its results stay up until the owner unpublishes the survey or deletes the project.',
  },
  zh: {
    footerFaq: '常见问题',
    faqIntroLink: '数据存在哪里，问卷会保留多久',
    faqTitle: '常见问题',
    faqLead: '托管版 SP-Survey 把数据存在哪里，以及一份问卷和它的结果会保留多久。',
    faqWhereTitle: '数据存在哪里？',
    faqWhereBody: '网站运行在 Cloudflare 上。问卷设计和参与者的回答保存在项目的 Supabase 数据库中。图片、视频等媒体文件保存在 Cloudflare R2。',
    faqHowLongTitle: '问卷和结果会保留多久？',
    faqHowLongBody: '平台没有自动到期时间。问卷和结果会一直保留，直到所有者取消发布或删除该项目。',
  },
};
