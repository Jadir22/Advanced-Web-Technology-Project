
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { Report } from "../../reports/entities/report.entity";

export enum MatchStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  REJECTED = "REJECTED",
}

@Entity("matches")
@Unique("UQ_matches_lost_found", [
  "lostReport",
  "foundReport",
])
@Check(
  "CHK_matches_distinct_reports",
  '"lost_report_id" <> "found_report_id"',
)
@Check(
  "CHK_matches_score_range",
  '"match_score" >= 0 AND "match_score" <= 100',
)
export class Match {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "lost_report_id" })
  lostReport!: Report;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "found_report_id" })
  foundReport!: Report;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    default: 0,
  })
  matchScore!: string;

  @Column({
    type: "enum",
    enum: MatchStatus,
    default: MatchStatus.PENDING,
  })
  status!: MatchStatus;

  @Column({
    type: "boolean",
    default: false,
  })
  lostConfirmed!: boolean;

  @Column({
    type: "boolean",
    default: false,
  })
  foundConfirmed!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
