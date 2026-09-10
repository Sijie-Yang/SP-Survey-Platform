import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectVersions from './ProjectVersions';
import { RegionProvider } from '../../contexts/RegionContext';
import { getProjectReleaseState, getProjectReleaseVersions, releaseProjectVersion } from '../../lib/projectManager';
jest.mock('../../lib/projectManager', () => ({getProjectReleaseState:jest.fn(),getProjectReleaseVersions:jest.fn(),releaseProjectVersion:jest.fn()}));
const config = {pages:[{name:'p',elements:[{type:'rating',name:'q',rateMax:5}]}]};
beforeEach(() => {
  localStorage.clear(); jest.clearAllMocks();
  getProjectReleaseState.mockResolvedValue({release_managed:false,published_version:0,draft_updated_at:'stamp',survey_config_draft:config,preloaded_images:[]});
  getProjectReleaseVersions.mockResolvedValue([]);
  releaseProjectVersion.mockResolvedValue({publishedVersion:1});
});
test('shows review before enabling versions and sends the reviewed concurrency token once', async () => {
  const onReleased=jest.fn();
  render(<RegionProvider><ProjectVersions currentProject={{id:'p'}} onReleased={onReleased}/></RegionProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Enable versions and release'}));
  expect(releaseProjectVersion).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button',{name:'Confirm release'}));
  await waitFor(()=>expect(onReleased).toHaveBeenCalledWith('p'));
  expect(releaseProjectVersion).toHaveBeenCalledTimes(1);
  expect(releaseProjectVersion).toHaveBeenCalledWith('p','stamp',{summary:'',restoreVersion:null});
});
test('unsaved edits block release; legacy snapshots cannot restore missing media', async () => {
  getProjectReleaseVersions.mockResolvedValue([{version:1,published_at:'2026-09-10',config,media_snapshot:null}]);
  render(<RegionProvider><ProjectVersions currentProject={{id:'p'}} hasUnsavedChanges/></RegionProvider>);
  expect(await screen.findByRole('button',{name:'Enable versions and release'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/v1/}));
  expect(screen.getByRole('button',{name:'Restore as new version…'})).toBeDisabled();
});
test('missing migration is shown explicitly, not as an empty successful history', async () => {
  getProjectReleaseState.mockRejectedValue(new Error('column release_managed does not exist'));
  render(<RegionProvider><ProjectVersions currentProject={{id:'p'}}/></RegionProvider>);
  expect(await screen.findByText(/column release_managed/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Enable versions and release'})).toBeNull();
});
