
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { QueryFailedError, Repository } from "typeorm";
import * as argon2 from "argon2";

import {
  User,
  UserRole,
} from "../users/entities/user.entity";

import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    };
  }

  async register(dto: RegisterDto): Promise<SafeUser> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException(
        "Email is already registered",
      );
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = this.userRepository.create({
      name: dto.name.trim(),
      email,
      passwordHash,
      role: UserRole.USER,
      isActive: true,
    });

    try {
      const savedUser = await this.userRepository.save(user);
      return this.toSafeUser(savedUser);
    } catch (error: unknown) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code ===
          "23505"
      ) {
        throw new ConflictException(
          "Email is already registered",
        );
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    // passwordHash has select:false in User Entity.
    // Explicitly select it only for password verification.
    const user = await this.userRepository
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("LOWER(user.email) = :email", { email })
      .getOne();

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        "Invalid email or password",
      );
    }

    const passwordValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );

    if (!passwordValid) {
      throw new UnauthorizedException(
        "Invalid email or password",
      );
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 3600,
      user: this.toSafeUser(user),
    };
  }
}
