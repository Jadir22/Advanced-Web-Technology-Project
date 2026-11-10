
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { Report } from "./report.entity";

import { CategoryField } from "../../categories/entities/category-field.entity";

@Entity("report_attributes")
@Unique("UQ_report_attributes_report_field", [
  "report",
  "categoryField",
])
export class ReportAttribute {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "report_id" })
  report!: Report;

  @ManyToOne(() => CategoryField, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "category_field_id" })
  categoryField!: CategoryField;

  @Column({
    type: "text",
  })
  value!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
