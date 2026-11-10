
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";

import { Category } from "./category.entity";

@Entity("category_fields")
@Unique("UQ_category_fields_category_field_key", [
  "category",
  "fieldKey",
])
export class CategoryField {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    type: "varchar",
    length: 80,
  })
  fieldKey!: string;

  @Column({
    type: "varchar",
    length: 120,
  })
  label!: string;

  @Column({
    type: "varchar",
    length: 30,
  })
  fieldType!: string;

  @Column({
    type: "jsonb",
    nullable: true,
  })
  options!: string[] | null;

  @Column({
    type: "boolean",
    default: false,
  })
  required!: boolean;

  @Column({
    type: "int",
    default: 0,
  })
  sortOrder!: number;

  @ManyToOne(
    () => Category,
    (category) => category.fields,
    {
      nullable: false,
      onDelete: "RESTRICT",
    },
  )
  @JoinColumn({
    name: "category_id",
    foreignKeyConstraintName: "FK_category_fields_category",
  })
  category!: Category;
}
