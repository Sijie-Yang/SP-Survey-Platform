import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageRankingWidget from './ImageRankingWidget';

jest.mock('../lib/questionImageChoices', () => ({resolveQuestionImageChoices: () => [
  {value: 'image_0', imageLink: '/a.jpg'}, {value: 'image_1', imageLink: '/b.jpg'},
]}));

test('displayed ranking is not an answer until explicitly confirmed', () => {
  const onValueChanged = jest.fn();
  render(<ImageRankingWidget question={{survey: {locale: 'zh-cn'}}} value={[]} onValueChanged={onValueChanged} />);
  expect(onValueChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: '确认当前顺序'}));
  expect(onValueChanged).toHaveBeenCalledWith(['image_0', 'image_1']);
});
