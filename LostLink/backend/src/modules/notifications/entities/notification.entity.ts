
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
} from "typeorm";

import { User } from "../../users/entities/user.entity";
import { Match } from "../../matches/entities/match.entity";

export enum NotificationType {
  MATCH_FOUND = "MATCH_FOUND",
  MATCH_CONFIRMED = "MATCH_CONFIRMED",
  PAYMENT_SUCCESS = "PAYMENT_SUCCESS",
  NEW_MESSAGE = "NEW_MESSAGE",
  SYSTEM = "SYSTEM",
}

@Entity("notifications")
@Index("IDX_notifications_user_read_created", [
  "user",
  "isRead",
  "createdAt",
])
export class Notification {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "user_id",
    foreignKeyConstraintName: "FK_notifications_user",
  })
  user!: User;

  @ManyToOne(() => Match, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({
    name: "match_id",
    foreignKeyConstraintName: "FK_notifications_match",
  })
  match!: Match | null;

  @Column({
    type: "enum",
    enum: NotificationType,
  })
  type!: NotificationType;

  @Column({
    type: "varchar",
    length: 200,
  })
  title!: string;

  @Column({
    type: "text",
  })
  body!: string;

  @Column({
    type: "boolean",
    default: false,
  })
  isRead!: boolean;

  @Column({
    type: "timestamp",
    nullable: true,
  })
  readAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
