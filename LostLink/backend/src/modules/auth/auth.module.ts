
import { Module } from "@nestjs/common";
import {
  ConfigModule,
  ConfigService,
} from "@nestjs/config";
import {
  JwtModule,
  JwtModuleOptions,
} from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";

import { User } from
  "../users/entities/user.entity";

import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService,
      ): JwtModuleOptions => {
        const secret =
          configService.get<string>(
            "JWT_BEARER_SECRET",
          );

        if (!secret || secret.length < 32) {
          throw new Error(
            "JWT_BEARER_SECRET must have at least 32 characters",
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn: "1h",
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
