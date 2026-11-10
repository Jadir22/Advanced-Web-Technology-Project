
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";

import { Report } from "./report.entity";

@Entity("report_areas")
@Index("IDX_report_areas_report_id", ["report"])
export class ReportArea {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "report_id",
    foreignKeyConstraintName: "FK_report_areas_report",
  })
  report!: Report;

  @Column({
    type: "varchar",
    length: 150,
  })
  areaName!: string;

  @Column({
    type: "varchar",
    length: 255,
    nullable: true,
  })
  specificPlace!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
