import type { ApiLogEvent, ApiTaskSnapshot } from '../../server/routes/control-center';

interface TaskUpdateMessage {
  type: 'task_updated';
  task: ApiTaskSnapshot;
}

interface TaskLogMessage {
  type: 'task_log';
  taskId: string;
  event: ApiLogEvent;
}

type TaskStreamMessage = TaskUpdateMessage | TaskLogMessage;

export interface TaskLogBridgeListener {
  onTaskUpdate?: (task: ApiTaskSnapshot) => void;
  onTaskLog?: (event: ApiLogEvent) => void;
  onError?: () => void;
}

/**
 * 基于 SSE 的前端日志桥接适配器。
 *
 * 控制中心只关心任务状态快照与增量日志，具体传输协议由该桥接器封装。
 */
export class SseTaskLogBridge {
  subscribe(taskId: string, listener: TaskLogBridgeListener): () => void {
    const eventSource = new EventSource(`/api/control/tasks/${taskId}/events`);

    eventSource.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as TaskStreamMessage;

        if (payload.type === 'task_updated') {
          listener.onTaskUpdate?.(payload.task);
          return;
        }

        listener.onTaskLog?.(payload.event);
      } catch {
        listener.onError?.();
      }
    };

    eventSource.onerror = () => {
      listener.onError?.();
    };

    return () => {
      eventSource.close();
    };
  }
}