
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "../../users/entities/user.entity";
import { Category } from "../../categories/entities/category.entity";

export enum ReportType {
  LOST = "LOST",
  FOUND = "FOUND",
}

export enum ReportStatus {
  OPEN = "OPEN",
  RESOLVED = "RESOLVED",
  CANCELLED = "CANCELLED",
}

@Entity("reports")
export class Report {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @ManyToOne(() => Category, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "category_id" })
  category!: Category;

  @Column({
    type: "enum",
    enum: ReportType,
  })
  reportType!: ReportType;

  @Column({
    type: "varchar",
    length: 200,
  })
  title!: string;

  @Column({
    type: "text",
    select: false,
  })
  description!: string;

  @Column({
    type: "date",
  })
  eventDate!: string;

  @Column({
    type: "enum",
    enum: ReportStatus,
    default: ReportStatus.OPEN,
  })
  status!: ReportStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
