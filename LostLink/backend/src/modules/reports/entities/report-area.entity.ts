
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from "typeorm";

import { Report } from "./report.entity";

@Entity("report_areas")
export class ReportArea {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "report_id" })
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
