
import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  ExtractJwt,
  Strategy,
} from "passport-jwt";
import { Repository } from "typeorm";
import { isUUID } from "class-validator";

import {
  User,
} from "../users/entities/user.entity";

@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy,
  "jwt",
) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.getOrThrow<string>(
          "JWT_BEARER_SECRET",
        ),
    });
  }

  async validate(payload: { sub?: unknown }) {
    if (
      typeof payload.sub !== "string" ||
      !isUUID(payload.sub)
    ) {
      throw new UnauthorizedException(
        "Invalid token payload",
      );
    }

    const user = await this.userRepository.findOne({
      where: {
        id: payload.sub,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        "User not found or inactive",
      );
    }

    return {
      id: user.id,
      email: user.email,
      roles: [user.role],
    };
  }
}
