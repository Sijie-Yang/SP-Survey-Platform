import { docTopic, topicSectionText } from './docsTopics';

const topic = docTopic('common-questions');

test('common questions are one platform wiki topic in both languages', () => {
  expect(topic.group).toBe('platform');
  expect(topic.sections.map((section) => section.id)).toEqual([
    'where', 'retention', 'without-ai', 'live-page', 'street-level',
    'preview', 'home', 'back', 'counts', 'templates',
  ]);
  const en = topicSectionText(topic, 'en');
  const zh = topicSectionText(topic, 'zh');
  expect(en).toMatch(/Cloudflare/);
  expect(en).toMatch(/Supabase/);
  expect(en).toMatch(/R2/);
  expect(en).toMatch(/no automatic expiry/i);
  expect(en).toMatch(/unpublishes the survey or deletes the project/);
  expect(en).toMatch(/without using it/);
  expect(en).toMatch(/Publish to Main Page/);
  expect(en).toMatch(/helper on your own computer/);
  expect(en).toMatch(/Layout Studio/);
  expect(en).toMatch(/Participant preview/);
  expect(en).toMatch(/Main page opens the public home/);
  expect(en).toMatch(/from Builder to Dataset/);
  expect(en).toMatch(/Total Responses/);
  expect(en).toMatch(/does not add a separate timer/);
  expect(en).toMatch(/My Projects/);
  expect(zh).toMatch(/Cloudflare/);
  expect(zh).toMatch(/Supabase/);
  expect(zh).toMatch(/R2/);
  expect(zh).toMatch(/没有自动到期/);
  expect(zh).toMatch(/取消发布或删除该项目/);
  expect(zh).toMatch(/不使用助手也可以发布/);
  expect(zh).toMatch(/发布到主页/);
  expect(zh).toMatch(/自己电脑上的一个小工具/);
  expect(zh).toMatch(/版式工作台/);
  expect(zh).toMatch(/参与者预览/);
  expect(zh).toMatch(/首页/);
  expect(zh).toMatch(/从「设计」回到「媒体」/);
  expect(zh).toMatch(/答卷总数/);
  expect(zh).toMatch(/已上线多少天/);
  expect(zh).toMatch(/我的项目/);
  expect(`${en}\n${zh}`).not.toMatch(/GDPR|€|\$\d|own Supabase|自己的 Supabase|collaborator|协作者|custom link|自定义链接/i);
});
