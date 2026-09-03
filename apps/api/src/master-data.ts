import type { FastifyInstance } from "fastify";
import { DomainError, type Repository, type UserIdentity } from "./domain.js";

export type MasterResource =
  | "campuses"
  | "classrooms"
  | "courses"
  | "teachers"
  | "guardians"
  | "students";

export interface MasterDataQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  activeOnly?: boolean;
  campusId?: string;
}

export interface MasterDataItem {
  id: string;
  name: string;
  isActive: boolean;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  timezone?: string;
  campusId?: string | null;
  campusName?: string | null;
  code?: string | null;
  capacity?: number;
  durationMinutes?: number;
  description?: string | null;
  specialty?: string | null;
  remark?: string | null;
  gender?: string | null;
  birthDate?: Date | null;
  guardians?: Array<{
    id: string;
    name: string;
    phone: string | null;
    relationship: string;
    isPrimary: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MasterDataPage {
  items: MasterDataItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MasterDataRepository {
  getMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): Promise<MasterDataItem | undefined>;
  listMasterData(
    organizationId: string,
    resource: MasterResource,
    query: MasterDataQuery,
  ): Promise<MasterDataPage>;
  createMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<MasterDataItem>;
  updateMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<MasterDataItem>;
  setMasterDataActive(
    organizationId: string,
    resource: MasterResource,
    id: string,
    isActive: boolean,
  ): Promise<MasterDataItem>;
  deleteMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): Promise<void>;
  setStudentGuardians(
    organizationId: string,
    studentId: string,
    links: Array<{ guardianId: string; relationship: string; isPrimary: boolean }>,
  ): Promise<MasterDataItem>;
}

const resources = new Set<MasterResource>([
  "campuses",
  "classrooms",
  "courses",
  "teachers",
  "guardians",
  "students",
]);

function resourceOf(value: string): MasterResource {
  if (!resources.has(value as MasterResource)) {
    throw new DomainError("RESOURCE_NOT_FOUND", "基础资料类型不存在", 404);
  }
  return value as MasterResource;
}

function text(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new DomainError("VALIDATION_ERROR", `请填写${field}`, 400);
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("VALIDATION_ERROR", `${field}格式不正确`, 400);
  }
  return value.trim();
}

function normalizeInput(resource: MasterResource, body: Record<string, unknown>) {
  const input: Record<string, unknown> = { name: text(body.name, "名称", true) };
  for (const field of ["phone", "email", "address", "timezone", "campusId", "code",
    "description", "specialty", "remark", "gender", "birthDate"]) {
    const value = text(body[field], field);
    if (value !== undefined) input[field] = value;
    else if (body[field] === null || body[field] === "") input[field] = null;
  }
  if (resource === "classrooms") {
    const capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new DomainError("VALIDATION_ERROR", "教室容量必须为正整数", 400);
    }
    input.capacity = capacity;
    input.campusId = text(body.campusId, "所属校区", true);
  }
  if (resource === "courses") {
    const durationMinutes = Number(body.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new DomainError("VALIDATION_ERROR", "课程时长必须为正整数", 400);
    }
    input.durationMinutes = durationMinutes;
  }
  return input;
}

export function registerMasterDataRoutes(
  app: FastifyInstance,
  repository: Repository,
  authorizeAdmin: (request: { auth: UserIdentity }) => Promise<void>,
): void {
  app.get<{
    Params: { resource: string };
    Querystring: {
      page?: string;
      pageSize?: string;
      keyword?: string;
      activeOnly?: string;
      campusId?: string;
    };
  }>("/admin/:resource", { preHandler: authorizeAdmin }, async (request) => {
    const page = Math.max(1, Number.parseInt(request.query.page ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(request.query.pageSize ?? "20", 10) || 20),
    );
    return {
      data: await repository.listMasterData(
        request.auth.organizationId,
        resourceOf(request.params.resource),
        {
          page,
          pageSize,
          ...(request.query.keyword ? { keyword: request.query.keyword.trim() } : {}),
          ...(request.query.activeOnly !== undefined
            ? { activeOnly: request.query.activeOnly === "true" }
            : {}),
          ...(request.query.campusId ? { campusId: request.query.campusId } : {}),
        },
      ),
    };
  });

  app.post<{
    Params: { resource: string };
    Body: Record<string, unknown>;
  }>("/admin/:resource", { preHandler: authorizeAdmin }, async (request, reply) => {
    const resource = resourceOf(request.params.resource);
    const item = await repository.createMasterData(
      request.auth.organizationId,
      resource,
      crypto.randomUUID(),
      normalizeInput(resource, request.body),
    );
    await audit(repository, request.auth, "MASTER_DATA_CREATED", resource, item.id, item);
    return reply.status(201).send({ data: item });
  });

  app.patch<{
    Params: { resource: string; id: string };
    Body: Record<string, unknown>;
  }>("/admin/:resource/:id", { preHandler: authorizeAdmin }, async (request) => {
    const resource = resourceOf(request.params.resource);
    const item = await repository.updateMasterData(
      request.auth.organizationId,
      resource,
      request.params.id,
      normalizeInput(resource, request.body),
    );
    await audit(repository, request.auth, "MASTER_DATA_UPDATED", resource, item.id, item);
    return { data: item };
  });

  app.delete<{
    Params: { resource: string; id: string };
  }>("/admin/:resource/:id", { preHandler: authorizeAdmin }, async (request, reply) => {
    const resource = resourceOf(request.params.resource);
    await repository.deleteMasterData(
      request.auth.organizationId,
      resource,
      request.params.id,
    );
    await audit(
      repository,
      request.auth,
      "MASTER_DATA_DELETED",
      resource,
      request.params.id,
      {},
    );
    return reply.status(204).send();
  });

  app.patch<{
    Params: { resource: string; id: string };
    Body: { isActive: boolean };
  }>("/admin/:resource/:id/status", { preHandler: authorizeAdmin }, async (request) => {
    if (typeof request.body.isActive !== "boolean") {
      throw new DomainError("VALIDATION_ERROR", "启停状态格式不正确", 400);
    }
    const resource = resourceOf(request.params.resource);
    const item = await repository.setMasterDataActive(
      request.auth.organizationId,
      resource,
      request.params.id,
      request.body.isActive,
    );
    await audit(repository, request.auth, "MASTER_DATA_STATUS_CHANGED", resource, item.id, {
      isActive: item.isActive,
    });
    return { data: item };
  });

  app.put<{
    Params: { id: string };
    Body: {
      guardians: Array<{ guardianId: string; relationship?: string; isPrimary?: boolean }>;
    };
  }>("/admin/students/:id/guardians", { preHandler: authorizeAdmin }, async (request) => {
    if (!Array.isArray(request.body.guardians)) {
      throw new DomainError("VALIDATION_ERROR", "监护人列表格式不正确", 400);
    }
    const links = request.body.guardians.map((link) => ({
      guardianId: text(link.guardianId, "监护人", true)!,
      relationship: text(link.relationship, "关系") ?? "监护人",
      isPrimary: link.isPrimary ?? false,
    }));
    if (links.filter((link) => link.isPrimary).length > 1) {
      throw new DomainError("VALIDATION_ERROR", "只能设置一位主要监护人", 400);
    }
    const item = await repository.setStudentGuardians(
      request.auth.organizationId,
      request.params.id,
      links,
    );
    await audit(repository, request.auth, "STUDENT_GUARDIANS_UPDATED", "students", item.id, {
      guardians: links,
    });
    return { data: item };
  });
}

async function audit(
  repository: Repository,
  identity: UserIdentity,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
) {
  await repository.saveAuditLog(identity.organizationId, {
    id: crypto.randomUUID(),
    actorId: identity.id,
    action,
    entityType,
    entityId,
    details,
    createdAt: new Date(),
  });
}
