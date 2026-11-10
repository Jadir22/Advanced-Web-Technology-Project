
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "../../users/entities/user.entity";
import { Match } from "../../matches/entities/match.entity";

export enum PaymentProvider {
  MOCK = "MOCK",
  BKASH = "BKASH",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

@Entity("payments")
@Index("IDX_payments_match_id", ["match"])
@Index(
  "UQ_payments_provider_transaction",
  ["provider", "transactionId"],
  { unique: true },
)
@Check("CHK_payments_amount_positive", '"amount" > 0')
export class Payment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "user_id",
    foreignKeyConstraintName: "FK_payments_user",
  })
  user!: User;

  @ManyToOne(() => Match, {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "match_id",
    foreignKeyConstraintName: "FK_payments_match",
  })
  match!: Match;

  @Column({
    type: "numeric",
    precision: 10,
    scale: 2,
  })
  amount!: string;

  @Column({
    type: "varchar",
    length: 3,
    default: "BDT",
  })
  currency!: string;

  @Column({
    type: "enum",
    enum: PaymentProvider,
    default: PaymentProvider.MOCK,
  })
  provider!: PaymentProvider;

  @Column({
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column({
    type: "varchar",
    length: 150,
    nullable: true,
  })
  providerPaymentId!: string | null;

  @Column({
    type: "varchar",
    length: 150,
    nullable: true,
  })
  transactionId!: string | null;

  @Column({
    type: "timestamp",
    nullable: true,
  })
  paidAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
