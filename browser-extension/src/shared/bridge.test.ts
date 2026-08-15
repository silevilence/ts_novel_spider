import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCaptureRequestState,
  describeBridgeProgress,
  type BridgeRuntimeState,
  type CaptureRequest,
} from './bridge';

const INITIAL_STATE: BridgeRuntimeState = {
  connected: true,
  taskId: null,
  taskState: 'idle',
  message: '',
  currentUrl: '',
  currentPhase: null,
  catalogUrl: '',
  currentTabId: null,
  pendingRequestId: null,
};

test('taskless metadata preview explains that the catalog opens after the current step', () => {
  const request: CaptureRequest = {
    type: 'capture_request',
    requestId: 'metadata-1',
    taskId: null,
    url: 'https://ncode.syosetu.com/novelview/infotop/ncode/n1234ab/',
    phase: 'metadata',
  };

  const state = applyCaptureRequestState(INITIAL_STATE, request);
  const progress = describeBridgeProgress(state);

  assert.equal(progress.title, '预览 · 作品信息');
  assert.match(progress.nextStep, /完成当前页后.*自动打开目录/);
  assert.equal(progress.saveLabel, '保存作品信息');
  assert.equal(state.catalogUrl, '');
});

test('catalog request records the real Syosetu catalog URL and exposes the catalog step', () => {
  const request: CaptureRequest = {
    type: 'capture_request',
    requestId: 'catalog-1',
    taskId: null,
    url: 'https://ncode.syosetu.com/n1234ab/',
    phase: 'catalog',
  };

  const state = applyCaptureRequestState(INITIAL_STATE, request);
  const progress = describeBridgeProgress(state);

  assert.equal(state.catalogUrl, 'https://ncode.syosetu.com/n1234ab/');
  assert.equal(progress.title, '预览 · 目录');
  assert.equal(progress.saveLabel, '保存目录');
});
