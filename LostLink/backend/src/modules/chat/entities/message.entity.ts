
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";

import { Conversation } from "./conversation.entity";
import { User } from "../../users/entities/user.entity";

@Entity("messages")
@Index("IDX_messages_conversation_created_at", [
  "conversation",
  "createdAt",
])
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Conversation, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "conversation_id",
    foreignKeyConstraintName: "FK_messages_conversation",
  })
  conversation!: Conversation;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "sender_id",
    foreignKeyConstraintName: "FK_messages_sender",
  })
  sender!: User;

  @Column({
    type: "text",
  })
  content!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
