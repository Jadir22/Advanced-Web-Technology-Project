
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
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
@Index("IDX_report_attributes_category_field_id", [
  "categoryField",
])
export class ReportAttribute {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "report_id",
    foreignKeyConstraintName: "FK_report_attributes_report",
  })
  report!: Report;

  @ManyToOne(() => CategoryField, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "category_field_id",
    foreignKeyConstraintName:
      "FK_report_attributes_category_field",
  })
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
