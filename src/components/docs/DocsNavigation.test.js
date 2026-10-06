import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import DocsNavigation, { docsNavigation, navigationPath } from './DocsNavigation';
jest.mock('react-router-dom', () => ({
  Link: require('react').forwardRef(({to,children,...props},ref)=><a ref={ref} href={to} {...props}>{children}</a>),
}), {virtual:true});
const view = (href, pages=[]) => <DocsNavigation nodes={docsNavigation('en',pages)} currentHref={href} language="en" />;
test('direct paper entry expands its two ancestors and highlights only the leaf', () => {
  render(view('/docs/2013-salesses-collaborative'));
  expect(screen.getByRole('button',{name:'Paper cases & templates'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('button',{name:'Illustrated guides'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('button',{name:'Template references'})).toHaveAttribute('aria-expanded','false');
  expect(screen.getByRole('link',{name:/Salesses et al/})).toHaveAttribute('aria-current','page');
  expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
test('parents only toggle; opening a sibling collapses the previous branch without changing the current page', () => {
  render(view('/docs/2013-salesses-collaborative'));
  fireEvent.click(screen.getByRole('button',{name:'Wiki',exact:true}));
  expect(screen.getByRole('button',{name:'Paper cases & templates'})).toHaveAttribute('aria-expanded','false');
  expect(screen.getByRole('button',{name:'Wiki',exact:true})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('link',{name:'Wiki overview'})).toHaveAttribute('href','/docs');
  expect(screen.queryByRole('link',{name:/Salesses et al/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Wiki',exact:true}));
  expect(screen.queryByRole('link',{name:'Wiki overview'})).not.toBeInTheDocument();
});
test('route transitions and back-navigation reveal the correct topic and paper branches', () => {
  const page=render(view('/docs/2013-salesses-collaborative'));
  page.rerender(view('/docs/q-score'));
  expect(screen.getByRole('button',{name:'Scoring & analysis'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('link',{name:'Q-score: scoring comparisons'})).toHaveAttribute('aria-current','page');
  page.rerender(view('/docs/2013-salesses-collaborative'));
  expect(screen.getByRole('link',{name:/Salesses et al/})).toHaveAttribute('aria-current','page');
  expect(screen.getByRole('button',{name:'Wiki',exact:true})).toHaveAttribute('aria-expanded','false');
});
test('submission pages and guides belong to the same branch, with distinct destinations', () => {
  const nodes=docsNavigation('en');
  for(const href of ['/docs/doc-news-submission','/contribute','/contribute?kind=doc_new','/contribute?kind=news','/contribute?kind=doc_edit']) {
    expect(navigationPath(nodes,href)[0].id).toBe('submit');
  }
  render(view('/contribute?kind=news'));
  expect(screen.getByRole('link',{name:'Submit research news'})).toHaveAttribute('aria-current','page');
  expect(screen.getByRole('link',{name:'Submit a tutorial / doc'})).toHaveAttribute('href','/contribute?kind=doc_new');
});
test('a community page arriving after route entry expands its branch', () => {
  const page=render(view('/docs/community-example'));
  page.rerender(view('/docs/community-example',[{page_key:'community-example',title:'Community guide'}]));
  expect(screen.getByRole('button',{name:'Community docs'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('link',{name:'Community guide'})).toHaveAttribute('aria-current','page');
});
