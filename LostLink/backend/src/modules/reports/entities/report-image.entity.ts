
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  CreateDateColumn,
} from "typeorm";

import { Report } from "./report.entity";

@Entity("report_images")
@Index("IDX_report_images_report_id", ["report"])
@Index("UQ_report_images_one_primary_per_report", ["report"], {
  unique: true,
  where: '"is_primary" = true',
})
@Check(
  "CHK_report_images_size_positive",
  '"size_bytes" > 0',
)
export class ReportImage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Report, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({
    name: "report_id",
    foreignKeyConstraintName: "FK_report_images_report",
  })
  report!: Report;

  @Column({
    type: "varchar",
    length: 512,
  })
  storageKey!: string;

  @Column({
    type: "varchar",
    length: 100,
  })
  mimeType!: string;

  @Column({
    type: "int",
  })
  sizeBytes!: number;

  @Column({
    type: "boolean",
    default: false,
  })
  isPrimary!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
