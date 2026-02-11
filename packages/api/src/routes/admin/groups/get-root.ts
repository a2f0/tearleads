import type { GroupsListResponse, GroupWithMemberCount } from '@rapid/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';

/**
 * @openapi
 * /admin/groups:
 *   get:
 *     summary: List all groups with member counts
 *     description: Returns all groups with their member counts
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of groups with member counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                       updatedAt:
 *                         type: string
 *                       memberCount:
 *                         type: number
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const getRootHandler = async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      organization_id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
      member_count: string;
    }>(`
      SELECT
        g.id,
        g.organization_id,
        g.name,
        g.description,
        g.created_at,
        g.updated_at,
        COUNT(ug.user_id)::text AS member_count
      FROM groups g
      LEFT JOIN user_groups ug ON ug.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name
    `);

    const groups: GroupWithMemberCount[] = result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      memberCount: parseInt(row.member_count, 10)
    }));

    const response: GroupsListResponse = { groups };
    res.json(response);
  } catch (err) {
    console.error('Groups error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch groups'
    });
  }
};

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
