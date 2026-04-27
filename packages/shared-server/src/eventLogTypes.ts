type EventLogInternal =
  | {
      ["event.name"]: "crawlerWorker.run";
      url: string;
      statusCode: number;
      proxy: string;
    }
  | { ["event.name"]: "user.login"; ["user.id"]: string }
  | { ["event.name"]: "user.signup"; ["user.id"]: string };

interface CommonEventLogFields {
  ["job.id"]: string;
  ["job.priority"]: number;
  ["job.run_number"]: number;
  ["user.id"]: string;
  ["user.role"]: string;
  ["user.tier"]: string;
}

export type EventLog = Partial<CommonEventLogFields> & EventLogInternal;

export type EventLogType = EventLog["event.name"];
