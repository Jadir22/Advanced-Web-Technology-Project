
import {
  Entity,
  PrimaryGeneratedColumn,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { Match } from "../../matches/entities/match.entity";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @OneToOne(() => Match, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "match_id",
    foreignKeyConstraintName: "FK_conversations_match",
  })
  match!: Match;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
