
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { Repository } from "typeorm";

import {
  User,
  UserRole,
} from "./entities/user.entity";

import { UpdateUserProfileDto } from
  "./dto/update-user-profile.dto";

import { UpdateUserStatusDto } from
  "./dto/update-user-status.dto";

import { ListUsersQueryDto } from
  "./dto/list-users-query.dto";

export interface SafeUserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedUsersResult {
  users: SafeUserProfile[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private toSafeUser(user: User): SafeUserProfile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private validateUserId(userId: string): void {
    if (!isUUID(userId)) {
      throw new UnauthorizedException(
        "Invalid authenticated user",
      );
    }
  }

  private async requireAdmin(
    actorUserId: string,
  ): Promise<void> {
    this.validateUserId(actorUserId);

    const actor = await this.userRepository.findOne({
      where: {
        id: actorUserId,
        isActive: true,
      },
    });

    if (!actor || actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        "Administrator access required",
      );
    }
  }

  // Authenticated user profile.
  async getProfile(
    actorUserId: string,
  ): Promise<SafeUserProfile> {
    this.validateUserId(actorUserId);

    const user = await this.userRepository.findOne({
      where: {
        id: actorUserId,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        "User not found or inactive",
      );
    }

    return this.toSafeUser(user);
  }

  // Users may update only their own name.
  async updateProfile(
    actorUserId: string,
    input: UpdateUserProfileDto,
  ): Promise<SafeUserProfile> {
    this.validateUserId(actorUserId);

    const name = input.name.trim();

    const updateResult =
      await this.userRepository.update(
        {
          id: actorUserId,
          isActive: true,
        },
        {
          name,
        },
      );

    if (updateResult.affected !== 1) {
      throw new UnauthorizedException(
        "User not found or inactive",
      );
    }

    return this.getProfile(actorUserId);
  }

  // ADMIN-only paginated list of users, including inactive ones.
  async listUsers(
    actorUserId: string,
    query: ListUsersQueryDto,
  ): Promise<PaginatedUsersResult> {
    await this.requireAdmin(actorUserId);

    const page = query.page;
    const limit = query.limit;

    const [users, total] =
      await this.userRepository.findAndCount({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        order: {
          createdAt: "DESC",
          id: "ASC",
        },
        skip: (page - 1) * limit,
        take: limit,
      });

    return {
      users: users.map((user) =>
        this.toSafeUser(user),
      ),
      total,
      page,
      limit,
    };
  }

  // ADMIN may activate/deactivate regular users.
  // Admin accounts cannot be modified here.
  async updateUserStatus(
    actorUserId: string,
    targetUserId: string,
    input: UpdateUserStatusDto,
  ): Promise<SafeUserProfile> {
    await this.requireAdmin(actorUserId);

    if (!isUUID(targetUserId)) {
      throw new NotFoundException(
        "Target user not found",
      );
    }

    if (actorUserId === targetUserId) {
      throw new ForbiddenException(
        "Administrators cannot change their own status",
      );
    }

    const target =
      await this.userRepository.findOne({
        where: {
          id: targetUserId,
        },
      });

    if (!target) {
      throw new NotFoundException(
        "Target user not found",
      );
    }

    if (target.role !== UserRole.USER) {
      throw new ForbiddenException(
        "Cannot change administrator status",
      );
    }

    const result = await this.userRepository.update(
      {
        id: targetUserId,
        role: UserRole.USER,
      },
      {
        isActive: input.isActive,
      },
    );

    if (result.affected !== 1) {
      throw new ConflictException(
        "User status could not be updated",
      );
    }

    const updated =
      await this.userRepository.findOne({
        where: {
          id: targetUserId,
        },
      });

    if (!updated) {
      throw new NotFoundException(
        "Target user not found",
      );
    }

    return this.toSafeUser(updated);
  }
}
