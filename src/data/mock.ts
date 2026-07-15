import type {
  CellValue,
  ColumnMeta,
  Connection,
  NewConnectionInput,
  QueryResult,
  TableMeta,
} from "../types";
import type { DataProvider } from "./provider";

const CONNECTIONS: Connection[] = [
  {
    id: "local-demo",
    name: "Local Demo",
    driver: "sqlite",
    host: "localhost",
    database: "demo.db",
    color: "#4ade80",
  },
  {
    id: "staging-mssql",
    name: "Staging (mock)",
    driver: "mssql",
    host: "staging.example.local",
    database: "AppDb",
    color: "#facc15",
  },
];

interface MockTable extends TableMeta {
  makeRow(i: number): CellValue[];
}

const FIRST_NAMES = ["Anna", "Ben", "Clara", "David", "Elena", "Farid", "Greta", "Hugo", "Ines", "Jonas"];
const CITIES = ["Hamburg", "Berlin", "Munich", "Rotterdam", "Vienna", "Zurich", "Copenhagen", "Gdansk"];
const STATUSES = ["open", "processing", "shipped", "delivered", "cancelled"];
const PRODUCTS = ["Pallet Jack", "Forklift Filter", "Dock Bumper", "Roller Door", "Sensor Kit", "Dock Leveler", "Seal Strip"];

// Cheap deterministic pseudo-random so every render of a table shows the same data.
function rand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(rand(seed) * arr.length)];
}

function isoDate(seed: number): string {
  const day = 1 + Math.floor(rand(seed) * 28);
  const month = 1 + Math.floor(rand(seed * 7) * 12);
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cols(...pairs: [string, string][]): ColumnMeta[] {
  return pairs.map(([name, dataType]) => ({ name, dataType }));
}

const TABLES: MockTable[] = [
  {
    schema: "dbo",
    name: "customers",
    kind: "table",
    rowCount: 5000,
    columns: cols(
      ["id", "int"],
      ["name", "nvarchar(100)"],
      ["city", "nvarchar(50)"],
      ["email", "nvarchar(200)"],
      ["is_active", "bit"],
      ["created_at", "date"],
    ),
    makeRow: (i) => {
      const name = `${pick(FIRST_NAMES, i)} ${pick(FIRST_NAMES, i * 3)}`;
      return [
        i + 1,
        name,
        pick(CITIES, i * 5),
        `${name.toLowerCase().replace(" ", ".")}@example.com`,
        rand(i * 11) > 0.15,
        isoDate(i),
      ];
    },
  },
  {
    schema: "dbo",
    name: "orders",
    kind: "table",
    rowCount: 25000,
    columns: cols(
      ["id", "int"],
      ["customer_id", "int"],
      ["status", "nvarchar(20)"],
      ["total", "decimal(12,2)"],
      ["ordered_at", "date"],
      ["note", "nvarchar(max)"],
    ),
    makeRow: (i) => [
      i + 1,
      1 + Math.floor(rand(i * 13) * 5000),
      pick(STATUSES, i * 17),
      Math.round(rand(i * 19) * 500000) / 100,
      isoDate(i * 23),
      rand(i * 29) > 0.8 ? "expedite" : null,
    ],
  },
  {
    schema: "dbo",
    name: "products",
    kind: "table",
    rowCount: 320,
    columns: cols(
      ["id", "int"],
      ["sku", "nvarchar(20)"],
      ["name", "nvarchar(100)"],
      ["price", "decimal(10,2)"],
      ["stock", "int"],
    ),
    makeRow: (i) => [
      i + 1,
      `SKU-${String(i + 1).padStart(5, "0")}`,
      `${pick(PRODUCTS, i)} ${1 + (i % 9)}`,
      Math.round(rand(i * 31) * 20000) / 100,
      Math.floor(rand(i * 37) * 800),
    ],
  },
  {
    schema: "billing",
    name: "invoices",
    kind: "table",
    rowCount: 18000,
    columns: cols(
      ["id", "int"],
      ["order_id", "int"],
      ["amount", "decimal(12,2)"],
      ["paid", "bit"],
      ["issued_at", "date"],
    ),
    makeRow: (i) => [
      i + 1,
      1 + Math.floor(rand(i * 41) * 25000),
      Math.round(rand(i * 43) * 500000) / 100,
      rand(i * 47) > 0.3,
      isoDate(i * 53),
    ],
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract "TOP n" / "LIMIT n" so the mock honors row limits in the SQL. */
function extractLimit(sql: string): number | null {
  const top = /\btop\s+(\d+)/i.exec(sql);
  if (top) return parseInt(top[1], 10);
  const limit = /\blimit\s+(\d+)/i.exec(sql);
  if (limit) return parseInt(limit[1], 10);
  return null;
}

let mockIdCounter = 0;

export const mockProvider: DataProvider = {
  async listConnections() {
    await delay(80);
    return [...CONNECTIONS];
  },

  async listRecentConnections() {
    await delay(40);
    return CONNECTIONS.map(({ id: _id, ...rest }) => rest);
  },

  async addConnection(input: NewConnectionInput) {
    await delay(60);
    mockIdCounter += 1;
    const connection: Connection = {
      id: `mock-${mockIdCounter}`,
      name: input.name.trim() || input.database,
      driver: input.driver,
      host: "local",
      database: input.database,
      color: input.color,
    };
    CONNECTIONS.push(connection);
    return connection;
  },

  async removeConnection(id: string) {
    await delay(40);
    const idx = CONNECTIONS.findIndex((c) => c.id === id);
    if (idx >= 0) CONNECTIONS.splice(idx, 1);
  },

  async createDemoDatabase() {
    await delay(60);
    let demo = CONNECTIONS.find((c) => c.id === "local-demo");
    if (!demo) {
      demo = {
        id: "local-demo",
        name: "Local Demo",
        driver: "sqlite",
        host: "localhost",
        database: "demo.db",
        color: "#4ade80",
      };
      CONNECTIONS.unshift(demo);
    }
    return demo;
  },

  async listDatabases(connectionId: string) {
    await delay(60);
    const conn = CONNECTIONS.find((c) => c.id === connectionId);
    if (conn?.driver === "mssql") return ["AppDb", "Analytics", "master"];
    if (conn?.driver === "postgres") return ["appdb", "analytics", "postgres"];
    return [];
  },

  async listTables(_connectionId: string, _database?: string) {
    await delay(150);
    return TABLES.map(({ makeRow: _makeRow, ...meta }) => meta);
  },

  async exportResult(): Promise<number> {
    throw new Error("Export is only available in the desktop app.");
  },

  async explainQuery(_connectionId: string, _sql: string, _database?: string) {
    await delay(120);
    return {
      columns: [{ name: "QUERY PLAN", dataType: "text" }],
      rows: [
        ["Seq Scan on customers  (cost=0.00..12.50 rows=250 width=64)"],
        ["  Filter: (city = 'Hamburg')"],
      ] as CellValue[][],
      totalRows: 2,
      durationMs: 3,
    } satisfies QueryResult;
  },

  async analyzeQuery(_connectionId: string, _sql: string, _database?: string) {
    await delay(160);
    return {
      label: "Hash Join",
      detail: "Hash Cond: (orders.customer_id = customers.id)",
      rows: 25000,
      timeMs: 4.2,
      cost: 812,
      parallel: false,
      extra: [
        ["Node Type", "Hash Join"],
        ["Join Type", "Inner"],
        ["Total Cost", "812.00"],
        ["Actual Total Time", "4.200"],
      ],
      children: [
        {
          label: "Seq Scan on orders",
          detail: null,
          rows: 25000,
          timeMs: 1.1,
          cost: 400,
          extra: [["Relation Name", "orders"], ["Actual Rows", "25000"]],
          parallel: true,
          children: [],
        },
        {
          label: "Hash",
          detail: null,
          rows: 5000,
          timeMs: 2.8,
          cost: 210,
          parallel: false,
          extra: [["Hash Buckets", "8192"]],
          children: [
            {
              label: "Seq Scan on customers",
              detail: "Filter: (city = 'Hamburg')",
              rows: 5000,
              timeMs: 2.5,
              cost: 180,
              parallel: false,
              extra: [["Filter", "(city = 'Hamburg')"], ["Rows Removed by Filter", "495"]],
              children: [],
            },
          ],
        },
      ],
    };
  },

  async runQuery(_connectionId: string, sql: string, _database?: string) {
    const started = performance.now();
    await delay(120 + Math.random() * 250);

    const trimmed = sql.trim();
    if (!trimmed) throw new Error("Empty query.");
    if (/\b(drop|delete|update|insert|alter|truncate)\b/i.test(trimmed)) {
      throw new Error("The mock provider is read-only — only SELECT is supported for now.");
    }

    const table = TABLES.find((t) =>
      new RegExp(`\\bfrom\\s+(\\[?${t.schema}\\]?\\.)?\\[?${t.name}\\]?\\b`, "i").test(trimmed),
    );
    if (!table) {
      throw new Error(
        `Mock provider: table not found in query. Known tables: ${TABLES.map((t) => `${t.schema}.${t.name}`).join(", ")}`,
      );
    }

    const limit = Math.min(extractLimit(trimmed) ?? 1000, table.rowCount);
    const rows: CellValue[][] = new Array(limit);
    for (let i = 0; i < limit; i++) rows[i] = table.makeRow(i);

    return {
      columns: table.columns,
      rows,
      totalRows: table.rowCount,
      durationMs: Math.round(performance.now() - started),
    } satisfies QueryResult;
  },
};
