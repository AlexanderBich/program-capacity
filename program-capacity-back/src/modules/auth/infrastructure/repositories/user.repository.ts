import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Nullable } from "@/common/types/common";
import { CreateUser, UserEntity } from "@/modules/auth/entities/user.entity";

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepositoryRaw: Repository<UserEntity>,
  ) {}

  findById(id: string): Promise<Nullable<UserEntity>> {
    return this.userRepositoryRaw.findOneBy({ id });
  }

  findByEmail(email: string): Promise<Nullable<UserEntity>> {
    return this.userRepositoryRaw.findOneBy({ email });
  }

  async insertIfEmailAbsent(values: CreateUser): Promise<void> {
    await this.userRepositoryRaw.createQueryBuilder().insert().values(values).orIgnore().execute();
  }
}
